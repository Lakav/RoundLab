package ice

import (
	"sync"
)

// inspired by https://github.com/DSergiu/node-ice (MIT License)

var (
	sMod = [][]uint64{
		{333, 313, 505, 369},
		{379, 375, 319, 391},
		{361, 445, 451, 397},
		{397, 425, 395, 505},
	}

	sXor = [][]uint64{
		{0x83, 0x85, 0x9b, 0xcd},
		{0xcc, 0xa7, 0xad, 0x41},
		{0x4b, 0x2e, 0xd4, 0x33},
		{0xea, 0xcb, 0x2e, 0x04},
	}

	pBox = []uint64{
		0x00000001, 0x00000080, 0x00000400, 0x00002000,
		0x00080000, 0x00200000, 0x01000000, 0x40000000,
		0x00000008, 0x00000020, 0x00000100, 0x00004000,
		0x00010000, 0x00800000, 0x04000000, 0x20000000,
		0x00000004, 0x00000010, 0x00000200, 0x00008000,
		0x00020000, 0x00400000, 0x08000000, 0x10000000,
		0x00000002, 0x00000040, 0x00000800, 0x00001000,
		0x00040000, 0x00100000, 0x02000000, 0x80000000,
	}

	keyrot = []int{
		0, 1, 2, 3, 2, 1, 3, 0,
		1, 3, 2, 0, 3, 1, 0, 2,
	}

	spBox      [][]uint64
	spBoxMutex sync.Mutex
)

type Key interface {
	Encrypt(data, enc []byte)
	Decrypt(enc, dec []byte)
	DecryptFromTo(enc []byte, from, to int) []byte
	DecryptAll(enc []byte) []byte
}

type keyImpl struct {
	level     int
	size      int
	rounds    int
	key       []byte
	schedule  [][]uint64
	encHolder []byte
	decHolder []byte
}

func gfMult(a, b, m uint64) (res uint64) {
	for b != 0 {
		if (b & 1) != 0 {
			res ^= a
		}

		a = a << 1
		b = b >> 1

		if a >= 256 {
			a ^= m
		}
	}

	return res
}

func gfExp7(b, m uint64) uint64 {
	if b == 0 {
		return 0
	}

	x := gfMult(b, b, m)
	x = gfMult(b, x, m)
	x = gfMult(x, x, m)

	return gfMult(b, x, m)
}

func perm32(x uint64) (res uint64) {
	for i := 0; x != 0; i++ {
		if (x & 1) != 0 {
			res |= pBox[i]
		}

		x = x >> 1
	}

	return
}

func ensureSpBoxInitialised() {
	// fast check without mutex
	if spBox != nil {
		return
	}

	spBoxMutex.Lock()
	defer spBoxMutex.Unlock()

	// check again after acquiring the mutex
	if spBox != nil {
		return
	}

	tmp := make([][]uint64, 4)

	for i := range tmp {
		tmp[i] = make([]uint64, 1024)
	}

	for i := uint64(0); i < 1024; i++ {
		col := (i >> 1) & 0xff
		row := (i & 0x1) | ((i & 0x200) >> 8)

		x := gfExp7(col^sXor[0][row], sMod[0][row]) << 24
		tmp[0][i] = perm32(x)

		x = gfExp7(col^sXor[1][row], sMod[1][row]) << 16
		tmp[1][i] = perm32(x)

		x = gfExp7(col^sXor[2][row], sMod[2][row]) << 8
		tmp[2][i] = perm32(x)

		x = gfExp7(col^sXor[3][row], sMod[3][row])
		tmp[3][i] = perm32(x)
	}

	spBox = tmp
}

func (k keyImpl) scheduleBuild(kb []uint16, n int, krotIdx int) {
	for i := 0; i < 8; i++ {
		kr := keyrot[krotIdx+i]
		subkey := k.schedule[n+i]

		for j := 0; j < 3; j++ {
			k.schedule[n+i][j] = 0
		}

		for j := 0; j < 15; j++ {
			currSk := j % 3

			for k := 0; k < 4; k++ {
				currKb := kb[(kr+k)&3]
				bit := currKb & 1

				subkey[currSk] = (subkey[currSk] << 1) | uint64(bit)
				kb[(kr+k)&3] = currKb>>1 | ((bit ^ 1) << 15)
			}
		}
	}
}

func NewKey(level int, key []byte) Key {
	ensureSpBoxInitialised()

	k := keyImpl{
		level:     level,
		key:       key,
		encHolder: make([]byte, 8),
		decHolder: make([]byte, 8),
	}

	if level < 1 {
		k.size = 1
		k.rounds = 8
	} else {
		k.size = level
		k.rounds = level * 16
	}

	k.schedule = make([][]uint64, k.rounds)

	for i := range k.schedule {
		k.schedule[i] = make([]uint64, 3)
	}

	kb := make([]uint16, 4)

	if k.rounds == 8 {
		for i := range kb {
			kb[3-i] = (uint16(key[i*2]&0xff) << 8) | uint16(key[i*2+1]&0xff)
		}

		k.scheduleBuild(kb, 0, 0)
		return k
	}

	for i := 0; i < k.size; i++ {
		for j := 0; j < 4; j++ {
			kb[3-j] = (uint16(key[i*8+j*2]&0xff) << 8) | uint16(key[i*8+j*2+1]&0xff)
		}

		k.scheduleBuild(kb, i*8, 0)
		k.scheduleBuild(kb, k.rounds-8-i*8, 8)
	}

	return k
}

func (k keyImpl) roundFunc(p uint64, subkey []uint64) uint64 {
	tl := ((p >> 16) & 0x3ff) | (((p >> 14) | (p << 18)) & 0xffc00)
	tr := (p & 0x3ff) | ((p << 2) & 0xffc00)

	al := subkey[2] & (tl ^ tr)
	ar := al ^ tr
	al ^= tl
	al ^= subkey[0]
	ar ^= subkey[1]

	return spBox[0][al>>10] | spBox[1][al&0x3ff] | spBox[2][ar>>10] | spBox[3][ar&0x3ff]
}

func (k keyImpl) Encrypt(data, enc []byte) {
	var l, r uint64

	for i := 0; i < 4; i++ {
		l |= uint64(data[i]&0xff) << uint(24-i*8)
		r |= uint64(data[i+4]&0xff) << uint(24-i*8)
	}

	for i := 0; i < k.rounds; i += 2 {
		l ^= k.roundFunc(r, k.schedule[i])
		r ^= k.roundFunc(l, k.schedule[i+1])
	}

	for i := 0; i < 4; i++ {
		enc[3-i] = byte(r & 0xff)
		enc[7-i] = byte(l & 0xff)

		r = r >> 8
		l = l >> 8
	}
}

func (k keyImpl) Decrypt(enc, dec []byte) {
	var l, r uint64

	for i := 0; i < 4; i++ {
		l |= uint64(enc[i]&0xff) << uint(24-i*8)
		r |= uint64(enc[i+4]&0xff) << uint(24-i*8)
	}

	for i := k.rounds - 1; i > 0; i -= 2 {
		l ^= k.roundFunc(r, k.schedule[i])
		r ^= k.roundFunc(l, k.schedule[i-1])
	}

	for i := 0; i < 4; i++ {
		dec[3-i] = byte(r & 0xff)
		dec[7-i] = byte(l & 0xff)

		r = r >> 8
		l = l >> 8
	}
}

func (k keyImpl) DecryptFromTo(enc []byte, from, to int) []byte {
	offset := 0
	dec := make([]byte, to-from)

	for from+8 <= to {
		for i := 0; i < 8; i++ {
			k.encHolder[i] = enc[from+i]
		}

		k.Decrypt(k.encHolder, k.decHolder)

		for i := 0; i < 8; i++ {
			dec[offset+i] = k.decHolder[i]
		}

		offset += 8
		from += 8
	}

	if ((to - from) & 0x7) != 0 {
		for i := from; i < to; i++ {
			dec[offset] = enc[i]
			offset++
		}
	}

	return dec
}

func (k keyImpl) DecryptAll(enc []byte) []byte {
	return k.DecryptFromTo(enc, 0, len(enc))
}

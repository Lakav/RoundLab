module gotvanalyser/parser

go 1.21.5

require (
	github.com/klauspost/compress v1.17.11
	github.com/markus-wa/demoinfocs-golang/v4 v4.5.1
)

// We vendor demoinfocs and patch sendtables2/entity.go so a missing entity
// during PVS update (`unable to find existing entity N`) is treated as a
// soft skip instead of panicking the goroutine. Plenty of CS2 demos hit
// this and there's no released upstream fix yet. See vendor/.../entity.go.

require (
	github.com/golang/geo v0.0.0-20230421003525-6adc56603217 // indirect
	github.com/golang/snappy v0.0.4 // indirect
	github.com/markus-wa/go-unassert v0.1.3 // indirect
	github.com/markus-wa/gobitread v0.2.4 // indirect
	github.com/markus-wa/godispatch v1.4.1 // indirect
	github.com/markus-wa/ice-cipher-go v0.0.0-20230901094113-348096939ba7 // indirect
	github.com/markus-wa/quickhull-go/v2 v2.2.0 // indirect
	github.com/oklog/ulid/v2 v2.1.0 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	google.golang.org/protobuf v1.36.4 // indirect
)

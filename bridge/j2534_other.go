//go:build !windows

package main

import "errors"

// J2534 drivers are Windows DLLs. On other systems only the simulator works.
func listDevices() ([]Device, error) { return []Device{}, nil }

func loadPassThru(d Device) (PassThru, error) {
	return nil, errors.New("J2534 drivers only run on Windows")
}

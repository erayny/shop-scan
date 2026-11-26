// Liftside Bridge: lets the Liftside scan app use a J2534 pass-thru device
// (for example a MaxiFlash) on a Windows PC. It serves the app on
// http://127.0.0.1:8534 and talks to the device through its J2534 driver.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"time"
)

func main() {
	port := flag.Int("port", 8534, "port on 127.0.0.1")
	sim := flag.String("sim", "", "use a simulated device and car (benz, lexus29) instead of a real one")
	noBrowser := flag.Bool("no-browser", false, "do not open the browser")
	flag.Parse()

	srv := NewServer(*port, *sim)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		fmt.Printf("Liftside Bridge cannot start: port %d is busy. Is it already running?\n", *port)
		pause()
		os.Exit(1)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", *port)
	fmt.Println("Liftside Bridge is running.")
	fmt.Println("Open " + url + " in Chrome or Edge. Keep this window open while you scan; close it to stop.")
	if devs, _ := srv.devices(); len(devs) == 0 {
		fmt.Println("No J2534 device is installed on this PC yet. Install your device's J2534 driver, then restart the bridge.")
	} else {
		for _, d := range devs {
			if d.Bits > 0 {
				fmt.Printf("  found: %s (%d-bit driver)\n", d.Name, d.Bits)
			} else {
				fmt.Printf("  found: %s\n", d.Name)
			}
		}
	}
	if !*noBrowser {
		openBrowser(url)
	}

	h := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt)
		<-stop
		srv.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		h.Shutdown(ctx)
	}()
	if err := h.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func openBrowser(url string) {
	if runtime.GOOS == "windows" {
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	}
}

func pause() {
	if runtime.GOOS == "windows" {
		fmt.Print("Press Enter to close.")
		fmt.Scanln()
	}
}

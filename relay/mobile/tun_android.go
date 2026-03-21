//go:build android

package mobile

/*
#include <stdint.h>

void disable_fdsan() {
#ifdef __ANDROID__
    extern void android_fdsan_set_error_level(uint32_t) __attribute__((weak));
    if (android_fdsan_set_error_level) {
        android_fdsan_set_error_level(0);
    }
#endif
}
*/
import "C"

import (
	"fmt"
	"os"

	"github.com/xjasonlyu/tun2socks/v2/engine"
)

func StartTun2Socks(fd, mtu, socksPort int) error {
	proxy := fmt.Sprintf("socks5://127.0.0.1:%d", socksPort)
	logMsg("tun2socks: starting fd=%d mtu=%d proxy=%s", fd, mtu, proxy)
	os.Setenv("TUN2SOCKS_LOG_LEVEL", "info")
	key := &engine.Key{
		Proxy:  proxy,
		Device: fmt.Sprintf("fd://%d", fd),
		MTU:    mtu,
	}
	engine.Insert(key)
	engine.Start()
	logMsg("tun2socks: running")
	return nil
}

func StopTun2Socks() {
	C.disable_fdsan()
	engine.Stop()
	logMsg("tun2socks: stopped")
}

package main

import (
	"fmt"
	"log"
	"regexp"
	"strings"
)

type VKConfig struct {
	AppID           string
	APIVersion      string
	SDKVersion      string
	AppVersion      string
	ProtocolVersion string
}

func fetchConfig() VKConfig {
	defaults := VKConfig{
		AppID:           "",
		APIVersion:      "",
		SDKVersion:      "",
		AppVersion:      "",
		ProtocolVersion: "",
	}

	// Discover current bundle URL
	page, err := httpGet("https://vk.com")
	if err != nil {
		log.Printf("[config] Failed to fetch vk.com: %v, using defaults", err)
		return defaults
	}

	bundleRe := regexp.MustCompile(`https://st\.vk\.com/dist/core_spa/core_spa_vk\.[a-f0-9]+\.js`)
	bundleURL := bundleRe.FindString(string(page))
	if bundleURL == "" {
		log.Printf("[config] Bundle URL not found in page, using defaults")
		return defaults
	}
	log.Printf("[config] Found bundle: %s", bundleURL)

	bundle, err := httpGet(bundleURL)
	if err != nil {
		log.Printf("[config] Failed to fetch bundle: %v, using defaults", err)
		return defaults
	}
	bundleStr := string(bundle)
	chunksBase := bundleURL[:strings.LastIndex(bundleURL, "core_spa_vk.")] + "chunks/"

	// Extract app_id and API version from the main bundle
	if m := regexp.MustCompile(`[,;]u=(\d{7,8}),_=\d{7,8},p=\d{8,9}`).FindStringSubmatch(bundleStr); m != nil {
		defaults.AppID = m[1]
	} else {
		log.Printf("[config] WARNING: app_id not found in bundle")
	}
	if m := regexp.MustCompile(`\d+:\(e,t,n\)=>\{"use strict";n\.d\(t,\{m:\(\)=>r\}\);const r="(5\.\d+)"\}`).FindStringSubmatch(bundleStr); m != nil {
		defaults.APIVersion = m[1]
	} else {
		log.Printf("[config] WARNING: apiVersion not found in bundle")
	}
	log.Printf("[config] app_id=%s api=%s", defaults.AppID, defaults.APIVersion)

	// Find webCallsBridge chunk
	bridgeRef := regexp.MustCompile(`core_spa/chunks/webCallsBridge\.([a-f0-9]+)\.js`).FindStringSubmatch(bundleStr)
	if bridgeRef == nil {
		log.Printf("[config] webCallsBridge chunk not found, using defaults for SDK")
		return defaults
	}
	bridgeURL := chunksBase + "webCallsBridge." + bridgeRef[1] + ".js"
	bridgeData, err := httpGet(bridgeURL)
	if err != nil {
		log.Printf("[config] Failed to fetch bridge chunk: %v", err)
		return defaults
	}
	bridgeStr := string(bridgeData)

	// Extract module IDs imported by the bridge
	requireRe := regexp.MustCompile(`i\((\d{4,6})\)`)
	matches := requireRe.FindAllStringSubmatch(bridgeStr, -1)
	seen := map[string]bool{}
	var moduleIds []string
	for _, m := range matches {
		if !seen[m[1]] {
			seen[m[1]] = true
			moduleIds = append(moduleIds, m[1])
		}
	}

	// Build chunk ID -> hash map from the bundle
	chunkMap := map[string]string{}
	chunkRe := regexp.MustCompile(`(\d+)===e\)return"core_spa/chunks/"\+e\+"\.([a-f0-9]+)\.js"`)
	for _, m := range chunkRe.FindAllStringSubmatch(bundleStr, -1) {
		chunkMap[m[1]] = m[2]
	}

	// Match module IDs to chunk IDs, fetch until sdkVersion found
	sdkVerRe := regexp.MustCompile(`sdkVersion.{0,40}return\s*"([^"]+)"`)
	appVerRe := regexp.MustCompile(`appVersion.{0,40}return\s+([0-9.]+)`)
	protoVerRe := regexp.MustCompile(`protocolVersion.{0,40}return.*?(\d+)`)

	for _, modId := range moduleIds {
		// try exact match, then with first digit dropped
		chunkId := modId
		hash, ok := chunkMap[chunkId]
		if !ok {
			chunkId = modId[1:]
			hash, ok = chunkMap[chunkId]
		}
		if !ok {
			continue
		}

		chunkURL := fmt.Sprintf("%s%s.%s.js", chunksBase, chunkId, hash)
		chunkData, err := httpGet(chunkURL)
		if err != nil {
			continue
		}
		chunkStr := string(chunkData)

		sv := sdkVerRe.FindStringSubmatch(chunkStr)
		if sv == nil {
			continue
		}

		log.Printf("[config] Found SDK in chunk %s", chunkId)
		defaults.SDKVersion = sv[1]
		if av := appVerRe.FindStringSubmatch(chunkStr); av != nil {
			defaults.AppVersion = av[1]
		} else {
			log.Printf("[config] WARNING: appVersion not found in SDK chunk")
		}
		if pv := protoVerRe.FindStringSubmatch(chunkStr); pv != nil {
			defaults.ProtocolVersion = pv[1]
		} else {
			log.Printf("[config] WARNING: protocolVersion not found in SDK chunk")
		}
		break
	}

	if defaults.SDKVersion == "" {
		log.Printf("[config] WARNING: sdkVersion not found in any chunk")
	}
	log.Printf("[config] sdk=%s app=%s proto=%s", defaults.SDKVersion, defaults.AppVersion, defaults.ProtocolVersion)
	return defaults
}

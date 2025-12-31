import * as fs from "fs"
import * as path from "path"
import * as net from "net"
import * as https from "https"
import axios from "axios"
import { SocksProxyAgent } from "socks-proxy-agent"
import { logger } from "../utils/logger"
import type { ProxyInfo, ProxyManagerOptions } from "../types"

export class ProxyManager {
  private proxies: ProxyInfo[] = []
  private bestProxy: ProxyInfo | null = null
  private currentProxy: ProxyInfo | null = null
  private proxySwitchFailures = 0
  private options: Required<ProxyManagerOptions>
  private keepAliveInterval: NodeJS.Timeout | null = null
  private currentKeepAliveUrlIndex = 0
  private proxyHealthScores: Map<string, number> = new Map()

  constructor(options: ProxyManagerOptions = {}) {
    this.options = {
      proxyType: 4,
      proxyFile: options.proxyFile || "",
      socks5Urls: ["https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt"],
      socks4Urls: ["https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt"],
      testUrls: ["https://httpbin.org/ip", "https://api.ipify.org?format=json"],
      testTimeout: 10000,
      maxConcurrentTests: 5,
      testCount: 5,
      rotationEnabled: true,
      verbose: false,
      keepAliveEnabled: true,
      keepAliveInterval: 10000,
      keepAliveUrls: [
        "https://8.8.8.8",
        "https://1.1.1.1",
        "https://208.67.222.222",
        "https://8.8.4.4",
        "https://httpbin.org/ip",
      ],
      ...options,
    }
    this.loadProxies()
  }

  private async loadProxies(): Promise<void> {
    const allProxies: ProxyInfo[] = []

    if (this.options.proxyType === 1 || this.options.proxyType === 2) {
      if (this.options.proxyFile) {
        const fileProxies = this.loadProxiesFromFile(this.options.proxyType === 2 ? "https" : "http")
        allProxies.push(...fileProxies)
      }
    } else if (this.options.proxyType === 3) {
      if (this.options.socks4Urls && this.options.socks4Urls.length > 0) {
        for (const url of this.options.socks4Urls) {
          const socks4Proxies = await this.loadProxiesFromUrl(url, "socks4")
          allProxies.push(...socks4Proxies)
        }
      }
    } else if (this.options.proxyType === 4) {
      if (this.options.socks5Urls && this.options.socks5Urls.length > 0) {
        for (const url of this.options.socks5Urls) {
          const socks5Proxies = await this.loadProxiesFromUrl(url, "socks5")
          allProxies.push(...socks5Proxies)
        }
      }
    }

    this.proxies = allProxies
    const proxyTypeName = this.getProxyTypeName(this.options.proxyType)
    logger.debug(`Loaded ${this.proxies.length} ${proxyTypeName} proxies`)
  }

  private loadProxiesFromFile(protocol: "http" | "https" = "http"): ProxyInfo[] {
    const proxies: ProxyInfo[] = []
    try {
      // proxyFile path is already resolved from project root in config
      const filePath = this.options.proxyFile!
      if (!fs.existsSync(filePath)) {
        logger.warn(`Proxy file not found: ${filePath}`)
        return proxies
      }

      const content = fs.readFileSync(filePath, "utf-8")
      const lines = content.split("\n").filter((line) => line.trim())

      for (const line of lines) {
        const proxy = this.parseProxy(line.trim(), protocol)
        if (proxy) {
          proxies.push(proxy)
        }
      }

      logger.info(`Loaded ${proxies.length} ${protocol.toUpperCase()} proxies from file: ${filePath}`)
    } catch (error) {
      logger.error(`Error loading proxies from file: ${error}`)
    }
    return proxies
  }

  private getProxyTypeName(proxyType: number): string {
    const names: Record<number, string> = {
      1: "HTTP",
      2: "HTTPS",
      3: "SOCKS4",
      4: "SOCKS5",
    }
    return names[proxyType] || "Unknown"
  }

  private async loadProxiesFromUrl(url: string, protocol: "socks5" | "socks4"): Promise<ProxyInfo[]> {
    const proxies: ProxyInfo[] = []
    try {
      logger.info(`Fetching ${protocol.toUpperCase()} proxies from: ${url}`)
      const response = await axios.get(url, { timeout: 10000 })
      const lines = response.data.split("\n").filter((line: string) => line.trim())

      for (const line of lines) {
        const proxy = this.parseProxy(line.trim(), protocol)
        if (proxy) {
          proxies.push(proxy)
        }
      }

      logger.info(`Loaded ${proxies.length} ${protocol.toUpperCase()} proxies from URL`)
    } catch (error) {
      logger.error(`Error loading ${protocol} proxies from URL ${url}: ${error}`)
    }
    return proxies
  }

  private parseProxy(proxyString: string, protocol: "http" | "https" | "socks4" | "socks5" = "http"): ProxyInfo | null {
    let parts: string[]

    if (proxyString.includes("://")) {
      const url = new URL(proxyString)
      protocol = url.protocol.replace(":", "") as "http" | "https" | "socks4" | "socks5"
      parts = [url.hostname, url.port]
    } else {
      parts = proxyString.split(":")
      if (parts.length !== 2) return null
    }

    const host = parts[0]
    const port = Number.parseInt(parts[1])

    if (!host || isNaN(port) || port < 1 || port > 65535) return null

    return { host, port, protocol }
  }

  private async pingProxy(proxy: ProxyInfo): Promise<number> {
    const startTime = Date.now()

    try {
      let axiosInstance: any

      if (proxy.protocol === "socks4" || proxy.protocol === "socks5") {
        const socksUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`
        const socksAgent = new SocksProxyAgent(socksUrl)

        axiosInstance = axios.create({
          httpAgent: socksAgent,
          httpsAgent: socksAgent,
          timeout: this.options.testTimeout,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        })
      } else {
        axiosInstance = axios.create({
          proxy: {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
          },
          timeout: this.options.testTimeout,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          httpsAgent:
            proxy.protocol === "https"
              ? new https.Agent({
                  rejectUnauthorized: false,
                })
              : undefined,
        })
      }

      const testUrl = "http://httpbin.org/ip"
      const response = await axiosInstance.get(testUrl)
      const responseTime = Date.now() - startTime

      if (response.status === 200 && response.data) {
        return responseTime
      }
    } catch (error: any) {
      const errorMsg = error.code || error.message || "Unknown error"
      logger.warn(`${proxy.host}:${proxy.port} failed with ${proxy.protocol}: ${errorMsg}`)
    }

    logger.error(`Proxy ${proxy.host}:${proxy.port} failed ${proxy.protocol} test`)
    return -1
  }

  private async findBestProxy(): Promise<void> {
    if (this.proxies.length === 0) return

    logger.debug("Testing proxies for speed...")

    const testProxies = []
    const shuffled = [...this.proxies].sort(() => 0.5 - Math.random())
    const testCount = Math.min(this.options.testCount, this.proxies.length)

    for (let i = 0; i < testCount; i++) {
      testProxies.push(shuffled[i])
    }

    logger.debug(`Testing ${testCount} proxies for speed`)

    const results = []
    for (const proxy of testProxies) {
      const responseTime = await this.pingProxy(proxy)
      if (responseTime > 0) {
        results.push({ ...proxy, responseTime })
      }
    }

    if (results.length > 0) {
      results.sort((a, b) => a.responseTime! - b.responseTime!)
      this.bestProxy = results[0]
      logger.info(
        `Best proxy selected: ${this.bestProxy.host}:${this.bestProxy.port} (${this.bestProxy.responseTime}ms)`,
      )
    } else {
      logger.error("No working proxies found")
    }
  }

  public async getWorkingProxy(): Promise<ProxyInfo | null> {
    if (this.proxies.length === 0) {
      logger.warn("No proxies available")
      return null
    }

    if (!this.bestProxy) {
      await this.findBestProxy()
    }

    if (this.bestProxy) {
      logger.info(`Using best proxy: ${this.bestProxy.host}:${this.bestProxy.port}`)
      this.currentProxy = this.bestProxy
      return this.bestProxy
    }

    logger.warn("Using fallback proxy (testing failed)")
    const fallback = this.proxies[0]
    logger.info(`Using fallback proxy: ${fallback.host}:${fallback.port}`)
    this.currentProxy = fallback
    return fallback
  }

  public getPuppeteerProxyArgs(proxy: ProxyInfo): string[] {
    if (!proxy || !proxy.host || !proxy.port) {
      logger.warn("Invalid proxy, skipping proxy args")
      return []
    }

    const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`
    logger.info(`Using proxy for Puppeteer: ${proxyUrl}`)
    return [`--proxy-server=${proxyUrl}`]
  }

  public getProxyCount(): number {
    return this.proxies.length
  }

  public getCurrentProxy(): ProxyInfo | null {
    return this.currentProxy
  }

  public async switchToNextProxy(): Promise<ProxyInfo | null> {
    if (this.proxies.length === 0) {
      logger.warn("No proxies available to switch to")
      return null
    }

    const currentKey = this.currentProxy ? `${this.currentProxy.host}:${this.currentProxy.port}` : null
    const availableProxies = this.proxies.filter((p) => `${p.host}:${p.port}` !== currentKey)

    if (availableProxies.length === 0) {
      logger.warn("No alternative proxies available")
      return null
    }

    const sortedProxies = availableProxies.sort((a, b) => {
      const keyA = `${a.host}:${a.port}`
      const keyB = `${b.host}:${b.port}`
      const scoreA = this.proxyHealthScores.get(keyA) || 0
      const scoreB = this.proxyHealthScores.get(keyB) || 0

      if (scoreA !== scoreB) {
        return scoreB - scoreA
      }
      return (a.responseTime || 99999) - (b.responseTime || 99999)
    })

    for (let i = 0; i < Math.min(3, sortedProxies.length); i++) {
      const candidateProxy = sortedProxies[i]

      logger.info(
        `Testing candidate proxy: ${candidateProxy.host}:${candidateProxy.port} (health: ${this.proxyHealthScores.get(`${candidateProxy.host}:${candidateProxy.port}`) || 0})`,
      )

      const responseTime = await this.pingProxy(candidateProxy)
      if (responseTime > 0 && responseTime < 8000) {
        const key = `${candidateProxy.host}:${candidateProxy.port}`
        this.proxyHealthScores.set(key, (this.proxyHealthScores.get(key) || 0) + 10)

        this.currentProxy = candidateProxy
        logger.success(`Switched to healthy proxy: ${candidateProxy.host}:${candidateProxy.port} (${responseTime}ms)`)
        return candidateProxy
      } else {
        const key = `${candidateProxy.host}:${candidateProxy.port}`
        this.proxyHealthScores.set(key, Math.max(0, (this.proxyHealthScores.get(key) || 0) - 5))
      }
    }

    logger.error("Could not find a working proxy to switch to")
    return null
  }

  public async monitorConnectionHealth(): Promise<boolean> {
    if (!this.currentProxy) return true

    try {
      const responseTime = await this.pingProxy(this.currentProxy)
      const isHealthy = responseTime > 0 && responseTime < 30000

      if (isHealthy && responseTime > 10000) {
        logger.warn(`Proxy response slow (${responseTime}ms), maintaining connection...`)
      }

      return isHealthy
    } catch (error) {
      return false
    }
  }

  public async getConnectionAdaptiveTimeout(baseTimeout: number): Promise<number> {
    if (!this.currentProxy) return baseTimeout

    try {
      const responseTime = await this.pingProxy(this.currentProxy)
      if (responseTime > 0) {
        const adaptiveMultiplier = Math.max(1, Math.min(3, responseTime / 2000))
        return Math.round(baseTimeout * adaptiveMultiplier)
      }
    } catch (error) {
      return baseTimeout * 2
    }

    return baseTimeout
  }

  public setCurrentProxy(proxy: ProxyInfo): void {
    this.currentProxy = proxy
    logger.info(`Current proxy set to: ${proxy.host}:${proxy.port} (${proxy.protocol})`)
    this.validateAndWarmUpProxy()
  }

  public getProxyHealthStats(): { [key: string]: number } {
    const stats: { [key: string]: number } = {}
    for (const [key, score] of this.proxyHealthScores.entries()) {
      stats[key] = score
    }
    return stats
  }

  private async validateAndWarmUpProxy(): Promise<void> {
    if (!this.currentProxy) return

    logger.info("Validating and warming up proxy connection...")

    try {
      const tcpOk = await this.testTcpConnectivity()
      if (!tcpOk) {
        logger.error("Proxy validation failed - TCP connection rejected")
        this.switchToNextProxy()
        return
      }

      const httpOk = await this.testHttpConnectivity()
      if (!httpOk) {
        logger.warn("Proxy validation warning - HTTP test failed but TCP works")
      }

      logger.success("Proxy validation successful")
      this.warmUpConnection()
    } catch (error) {
      logger.error(`Proxy validation error: ${error}`)
      this.switchToNextProxy()
    }
  }

  public async warmUpConnection(): Promise<void> {
    if (!this.currentProxy) return

    logger.info("Warming up proxy connection for maximum speed...")

    try {
      const warmUpPromises = []
      for (let i = 0; i < 5; i++) {
        warmUpPromises.push(this.performAggressiveKeepAlivePing())
      }

      await Promise.allSettled(warmUpPromises)
      logger.success("Proxy connection warmed up and stabilized")
    } catch (error) {
      logger.warn("Connection warm-up completed with some issues (normal)")
    }
  }

  public isStableMode(): boolean {
    return this.options.proxyType === 5
  }

  public shouldUseProxyForCriticalOperations(): boolean {
    return this.options.proxyType !== 5 && this.currentProxy !== null
  }

  public startKeepAlive(): void {
    if (!this.options.keepAliveEnabled || this.keepAliveInterval) {
      return
    }

    logger.debug(`Starting proxy keep-alive pings every ${this.options.keepAliveInterval / 1000}s`)

    this.keepAliveInterval = setInterval(async () => {
      if (this.currentProxy) {
        try {
          await this.performAggressiveKeepAlivePing()
        } catch (error) {
          // Silent failure
        }
      }
    }, this.options.keepAliveInterval)
  }

  public stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
      logger.info("Stopped proxy keep-alive pings")
    }
  }

  private async performAggressiveKeepAlivePing(): Promise<"healthy" | "tcp_lost" | "http_failed"> {
    if (!this.currentProxy) return "healthy"

    try {
      const tcpConnected = await this.testTcpConnectivity()
      if (!tcpConnected) {
        return "tcp_lost"
      }

      const httpWorking = await this.testHttpConnectivity()
      if (!httpWorking) {
        return "http_failed"
      }

      return "healthy"
    } catch (error) {
      return "http_failed"
    }
  }

  private async testTcpConnectivity(): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = 1500

      const socket = net.createConnection({
        host: this.currentProxy!.host,
        port: this.currentProxy!.port,
      })

      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, timeout)

      socket.on("connect", () => {
        clearTimeout(timer)
        socket.end()
        resolve(true)
      })

      socket.on("error", () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  private async testHttpConnectivity(): Promise<boolean> {
    try {
      let axiosInstance: any

      if (this.currentProxy!.protocol === "socks4" || this.currentProxy!.protocol === "socks5") {
        const socksUrl = `${this.currentProxy!.protocol}://${this.currentProxy!.host}:${this.currentProxy!.port}`
        axiosInstance = axios.create({
          httpAgent: new SocksProxyAgent(socksUrl),
          timeout: 3000,
          headers: { "User-Agent": "Mozilla/5.0" },
        })
      } else {
        axiosInstance = axios.create({
          proxy: {
            host: this.currentProxy!.host,
            port: this.currentProxy!.port,
            protocol: this.currentProxy!.protocol,
          },
          timeout: 3000,
          headers: { "User-Agent": "Mozilla/5.0" },
        })
      }

      const response = await axiosInstance.get("http://httpbin.org/get", {
        timeout: 2500,
        validateStatus: (status: number) => status < 400,
      })

      const success = response.status < 400

      const key = `${this.currentProxy!.host}:${this.currentProxy!.port}`
      if (success) {
        this.proxyHealthScores.set(key, (this.proxyHealthScores.get(key) || 0) + 1)
      } else {
        this.proxyHealthScores.set(key, Math.max(0, (this.proxyHealthScores.get(key) || 0) - 2))
      }

      return success
    } catch (error) {
      const key = `${this.currentProxy!.host}:${this.currentProxy!.port}`
      this.proxyHealthScores.set(key, Math.max(0, (this.proxyHealthScores.get(key) || 0) - 3))
      return false
    }
  }

  public async getConnectionQuality(): Promise<"excellent" | "good" | "poor" | "critical"> {
    if (!this.currentProxy) return "excellent"

    try {
      const responseTime = await this.pingProxy(this.currentProxy)
      if (responseTime < 2000) return "excellent"
      if (responseTime < 5000) return "good"
      if (responseTime < 10000) return "poor"
      return "critical"
    } catch (error) {
      return "critical"
    }
  }

  public async monitorConnectionSpeed(): Promise<boolean> {
    if (!this.currentProxy) return true

    const responseTime = await this.pingProxy(this.currentProxy)
    if (responseTime < 0) {
      logger.error("Current proxy is not responding")
      return false
    }

    if (responseTime > 5000) {
      logger.warn(`Current proxy is slow (${responseTime}ms), considering switch...`)
      return false
    }

    return true
  }
}

export default ProxyManager

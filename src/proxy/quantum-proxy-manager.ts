import axios, { type AxiosInstance } from "axios"
import { SocksProxyAgent } from "socks-proxy-agent"
import * as net from "net"
import * as dns from "dns"
import { promisify } from "util"
import { SecureConnectionManager } from "./secure-connection-manager"
import { logger } from "../utils/logger"
import type { QuantumProxyConfig, ConnectionMetrics } from "../types"

const dnsLookup = promisify(dns.lookup)

interface SmartConnection {
  proxy: QuantumProxyConfig
  metrics: ConnectionMetrics
  axiosInstance: AxiosInstance
  lastUsed: number
  connectionPool: AxiosInstance[]
  dnsCache: Map<string, { ip: string; ttl: number }>
  securityMetrics?: any
}

export class QuantumProxyManager {
  private connections: Map<string, SmartConnection> = new Map()
  private currentConnection: SmartConnection | null = null
  private connectionPoolSize = 3
  private dnsCache = new Map<string, { ip: string; expires: number }>()
  private dnsCacheTTL = 300000
  private secureManager: SecureConnectionManager
  private keepAliveInterval: NodeJS.Timeout | null = null

  constructor(private targetDomain = "act.playcfl.com") {
    this.secureManager = new SecureConnectionManager({
      enableCertificatePinning: true,
      enableClientCertificates: false,
      allowedNetworks: ["0.0.0.0/0"],
      blockedNetworks: [],
      tlsFingerprintCheck: true,
      maxTlsVersion: "TLSv1.3",
      minTlsVersion: "TLSv1.2",
      enableHstsPreload: true,
      securityHeadersCheck: true,
    })
  }

  async initializeQuantumConnection(proxyConfig: QuantumProxyConfig): Promise<boolean> {
    const connectionKey = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`

    try {
      logger.debug(`Initializing quantum connection for ${connectionKey}`)

      await this.quantumDNSResolve(this.targetDomain)

      logger.debug("Performing security assessment...")
      const securityMetrics = await this.secureManager.establishSecureConnection(proxyConfig.host, proxyConfig.port, {
        useTls: false,
        timeout: 10000,
      })

      if (securityMetrics.securityScore < 60) {
        logger.warn(`Proxy security score too low (${securityMetrics.securityScore}/100)`)
        logger.debug(`Security issues: ${securityMetrics.vulnerabilities.join(", ")}`)
      }

      const connection: SmartConnection = {
        proxy: proxyConfig,
        metrics: await this.measureConnectionQuality(proxyConfig),
        axiosInstance: this.createSecureOptimizedAxiosInstance(proxyConfig),
        lastUsed: Date.now(),
        connectionPool: [],
        dnsCache: new Map(),
        securityMetrics,
      }

      connection.connectionPool = await this.createConnectionPool(proxyConfig, this.connectionPoolSize)

      const quantumTest = await this.performQuantumConnectivityTest(connection)
      if (!quantumTest) {
        logger.error(`Quantum connection test failed for ${connectionKey}`)
        return false
      }

      this.connections.set(connectionKey, connection)
      this.currentConnection = connection

      logger.success(`Quantum connection established: stability ${connection.metrics.stability}/100`)
      return true
    } catch (error) {
      logger.error(`Quantum connection initialization failed: ${error}`)
      return false
    }
  }

  private async quantumDNSResolve(domain: string): Promise<string> {
    const cached = this.dnsCache.get(domain)
    if (cached && cached.expires > Date.now()) {
      return cached.ip
    }

    try {
      const { address } = await dnsLookup(domain)
      this.dnsCache.set(domain, {
        ip: address,
        expires: Date.now() + this.dnsCacheTTL,
      })
      return address
    } catch (error) {
      if (cached) {
        logger.warn(`DNS lookup failed, using cached IP: ${cached.ip}`)
        return cached.ip
      }
      throw error
    }
  }

  private async measureConnectionQuality(proxy: QuantumProxyConfig): Promise<ConnectionMetrics> {
    const metrics: ConnectionMetrics = {
      latency: 0,
      jitter: 0,
      packetLoss: 0,
      bandwidth: 0,
      lastTested: Date.now(),
      stability: 0,
    }

    try {
      const tcpStart = Date.now()
      const tcpSuccess = await this.testTCPHandshake(proxy)
      const tcpTime = Date.now() - tcpStart

      if (!tcpSuccess) {
        return { ...metrics, stability: 0 }
      }

      const httpSamples = []
      for (let i = 0; i < 5; i++) {
        const start = Date.now()
        const success = await this.testHTTPConnectivity(proxy)
        const time = Date.now() - start
        if (success) httpSamples.push(time)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (httpSamples.length === 0) {
        return { ...metrics, stability: 10 }
      }

      metrics.latency = httpSamples.reduce((a, b) => a + b) / httpSamples.length
      metrics.jitter = this.calculateJitter(httpSamples)
      metrics.packetLoss = ((5 - httpSamples.length) / 5) * 100

      const latencyScore = Math.max(0, 100 - metrics.latency / 10)
      const jitterScore = Math.max(0, 100 - metrics.jitter * 10)
      const lossScore = 100 - metrics.packetLoss

      metrics.stability = Math.round((latencyScore + jitterScore + lossScore) / 3)
    } catch (error) {
      metrics.stability = 0
    }

    return metrics
  }

  private createSecureOptimizedAxiosInstance(proxy: QuantumProxyConfig): AxiosInstance {
    const secureInstance = this.secureManager.createSecureAxiosInstance()

    let agent: any

    if (proxy.protocol === "socks4" || proxy.protocol === "socks5") {
      const socksUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`
      agent = new SocksProxyAgent(socksUrl)
    }

    return axios.create({
      ...secureInstance.defaults,
      proxy: proxy.protocol.startsWith("http")
        ? {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
            auth:
              proxy.username && proxy.password
                ? {
                    username: proxy.username,
                    password: proxy.password,
                  }
                : undefined,
          }
        : undefined,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
    })
  }

  private createOptimizedAxiosInstance(proxy: QuantumProxyConfig): AxiosInstance {
    let agent: any

    if (proxy.protocol === "socks4" || proxy.protocol === "socks5") {
      const socksUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`
      agent = new SocksProxyAgent(socksUrl)
    }

    return axios.create({
      proxy: proxy.protocol.startsWith("http")
        ? {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
            auth:
              proxy.username && proxy.password
                ? {
                    username: proxy.username,
                    password: proxy.password,
                  }
                : undefined,
          }
        : undefined,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    })
  }

  private async createConnectionPool(proxy: QuantumProxyConfig, poolSize: number): Promise<AxiosInstance[]> {
    const pool: AxiosInstance[] = []

    for (let i = 0; i < poolSize; i++) {
      const instance = this.createOptimizedAxiosInstance(proxy)
      try {
        await instance.get("http://httpbin.org/status/200", { timeout: 3000 })
        pool.push(instance)
      } catch (error) {
        // Connection failed, skip
      }
    }

    logger.debug(`Created connection pool with ${pool.length}/${poolSize} instances`)
    return pool
  }

  private async performQuantumConnectivityTest(connection: SmartConnection): Promise<boolean> {
    try {
      const handshakeSuccess = await this.simulateThreeWayHandshake(connection.proxy)
      if (!handshakeSuccess) return false

      const chunkedSuccess = await this.testChunkedRequests(connection)
      if (!chunkedSuccess) return false

      const seedingSuccess = await this.performConnectionSeeding(connection)
      if (!seedingSuccess) return false

      return true
    } catch (error) {
      return false
    }
  }

  private async simulateThreeWayHandshake(proxy: QuantumProxyConfig): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: proxy.host,
        port: proxy.port,
        timeout: 5000,
      })

      const startTime = Date.now()

      socket.on("connect", () => {
        const handshakeTime = Date.now() - startTime
        socket.end()
        resolve(handshakeTime < 3000)
      })

      socket.on("error", () => resolve(false))
      socket.on("timeout", () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  private async testChunkedRequests(connection: SmartConnection): Promise<boolean> {
    try {
      const response = await connection.axiosInstance.get("http://httpbin.org/stream/5", {
        timeout: 10000,
        responseType: "stream",
      })

      return response.status === 200
    } catch (error) {
      return false
    }
  }

  private async performConnectionSeeding(connection: SmartConnection): Promise<boolean> {
    const seedRequests = ["http://httpbin.org/status/200", "http://httpbin.org/json", "http://httpbin.org/headers"]

    try {
      const promises = seedRequests.map((url) => connection.axiosInstance.get(url, { timeout: 3000 }))

      const results = await Promise.allSettled(promises)
      const successCount = results.filter(
        (result) => result.status === "fulfilled" && result.value.status === 200,
      ).length

      return successCount >= 2
    } catch (error) {
      return false
    }
  }

  async getOptimizedConnection(): Promise<AxiosInstance | null> {
    if (!this.currentConnection) return null

    this.currentConnection.lastUsed = Date.now()

    if (this.currentConnection.connectionPool.length > 0) {
      const connection = this.currentConnection.connectionPool.shift()!
      this.currentConnection.connectionPool.push(connection)
      return connection
    }

    return this.currentConnection.axiosInstance
  }

  async switchToBestProxy(): Promise<boolean> {
    if (this.connections.size === 0) return false

    let bestConnection: SmartConnection | null = null
    let bestScore = -1

    for (const connection of this.connections.values()) {
      if (connection.metrics.stability > bestScore) {
        bestScore = connection.metrics.stability
        bestConnection = connection
      }
    }

    if (bestConnection && bestConnection !== this.currentConnection) {
      this.currentConnection = bestConnection
      logger.info(`Switched to best proxy: stability ${bestScore}/100`)
      return true
    }

    return false
  }

  private async testTCPHandshake(proxy: QuantumProxyConfig): Promise<boolean> {
    return this.simulateThreeWayHandshake(proxy)
  }

  private async testHTTPConnectivity(proxy: QuantumProxyConfig): Promise<boolean> {
    try {
      const instance = this.createOptimizedAxiosInstance(proxy)
      const response = await instance.get("http://httpbin.org/get", { timeout: 5000 })
      return response.status === 200
    } catch (error) {
      return false
    }
  }

  private calculateJitter(samples: number[]): number {
    if (samples.length < 2) return 0

    let totalJitter = 0
    for (let i = 1; i < samples.length; i++) {
      totalJitter += Math.abs(samples[i] - samples[i - 1])
    }

    return totalJitter / (samples.length - 1)
  }

  getConnectionMetrics(): ConnectionMetrics | null {
    return this.currentConnection?.metrics || null
  }

  configureClientCertificates(privateKeyPath: string, certificatePath: string, caCertificatePath?: string): void {
    this.secureManager.updateSecurityConfig({
      enableClientCertificates: true,
      privateKeyPath,
      certificatePath,
      caCertificatePath,
    })
    logger.info("Client certificate authentication configured")
  }

  configureNetworkAccess(allowedNetworks: string[], blockedNetworks: string[] = []): void {
    this.secureManager.updateSecurityConfig({
      allowedNetworks,
      blockedNetworks,
    })
    logger.info(`Network access configured: ${allowedNetworks.length} allowed, ${blockedNetworks.length} blocked`)
  }

  getSecurityMetrics(): any {
    return this.currentConnection?.securityMetrics || null
  }

  startKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
    }

    logger.debug("Starting quantum keep-alive pings every 10 seconds")

    this.keepAliveInterval = setInterval(async () => {
      if (this.currentConnection) {
        try {
          await this.performAggressiveKeepAlivePing()
        } catch (error) {
          // Silent keep-alive failure
        }
      }
    }, 10000)
  }

  stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
      logger.info("Stopped quantum keep-alive pings")
    }
  }

  private async performAggressiveKeepAlivePing(): Promise<"healthy" | "tcp_lost" | "http_failed"> {
    if (!this.currentConnection) return "healthy"

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
        host: this.currentConnection!.proxy.host,
        port: this.currentConnection!.proxy.port,
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
      const instance = this.currentConnection!.axiosInstance
      const response = await instance.get("http://httpbin.org/get", {
        timeout: 3000,
        validateStatus: (status: number) => status < 400,
      })

      return response.status < 400
    } catch (error) {
      return false
    }
  }

  async performSecurityAudit(): Promise<{
    score: number
    vulnerabilities: string[]
    recommendations: string[]
    riskLevel: string
  }> {
    if (!this.currentConnection) {
      throw new Error("No active connection to audit")
    }

    const metrics = this.currentConnection.securityMetrics
    if (!metrics) {
      throw new Error("No security metrics available")
    }

    const riskLevel =
      metrics.securityScore >= 80
        ? "LOW"
        : metrics.securityScore >= 60
          ? "MEDIUM"
          : metrics.securityScore >= 40
            ? "HIGH"
            : "CRITICAL"

    return {
      score: metrics.securityScore,
      vulnerabilities: metrics.vulnerabilities,
      recommendations: metrics.recommendations,
      riskLevel,
    }
  }

  async cleanup(): Promise<void> {
    this.dnsCache.clear()
    this.secureManager.clearSecurityCaches()
    this.connections.clear()
    this.currentConnection = null

    logger.debug("Quantum proxy manager cleaned up")
  }
}

export default QuantumProxyManager

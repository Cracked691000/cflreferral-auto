export interface RegistrationConfig {
  email: string
  password: string
  referralCode?: string
}

export interface TempEmailAccount {
  email_addr: string
  sid_token: string
  alias: string
}

export interface EmailMessage {
  mail_id: string
  mail_from: string
  mail_subject: string
  mail_excerpt: string
  mail_timestamp: string
  mail_read: number
  mail_date: string
}

export interface GetEmailListResponse {
  list: EmailMessage[]
  count: number | string
  email: string
  alias?: string
  ts?: number
  sid_token?: string
}

export interface ProxyInfo {
  host: string
  port: number
  protocol: "http" | "https" | "socks4" | "socks5"
  responseTime?: number
  server?: string
  username?: string
  password?: string
}

export interface ProxyManagerOptions {
  proxyType?: number
  proxyFile?: string
  socks5Urls?: string[]
  socks4Urls?: string[]
  testUrls?: string[]
  testTimeout?: number
  maxConcurrentTests?: number
  testCount?: number
  rotationEnabled?: boolean
  verbose?: boolean
  keepAliveEnabled?: boolean
  keepAliveInterval?: number
  keepAliveUrls?: string[]
}

export interface QuantumProxyConfig {
  host: string
  port: number
  protocol: "http" | "https" | "socks4" | "socks5"
  username?: string
  password?: string
}

export interface ConnectionMetrics {
  latency: number
  jitter: number
  packetLoss: number
  bandwidth: number
  lastTested: number
  stability: number
}

export interface SecurityConfig {
  enableCertificatePinning: boolean
  enableClientCertificates: boolean
  allowedNetworks: string[]
  blockedNetworks: string[]
  tlsFingerprintCheck: boolean
  maxTlsVersion: "TLSv1.2" | "TLSv1.3"
  minTlsVersion: "TLSv1.2" | "TLSv1.3"
  cipherSuites: string[]
  privateKeyPath?: string
  certificatePath?: string
  caCertificatePath?: string
  enableHstsPreload: boolean
  securityHeadersCheck: boolean
}

export interface CertificateInfo {
  subject: string
  issuer: string
  validFrom: Date
  validTo: Date
  fingerprint: string
  serialNumber: string
  publicKeyAlgorithm: string
  keySize: number
  isValid: boolean
  daysUntilExpiry: number
}

export interface NetworkSecurity {
  ipAddress: string
  isAllowed: boolean
  isBlocked: boolean
  networkRange: string
  riskLevel: "low" | "medium" | "high" | "critical"
}

export interface SecureConnectionMetrics {
  tlsVersion: string
  cipherSuite: string
  certificateInfo: CertificateInfo
  networkSecurity: NetworkSecurity
  securityScore: number
  vulnerabilities: string[]
  recommendations: string[]
}

export interface BotConfig {
  levelinfBaseUrl: string
  referralCode: string
  headless: boolean
  useProxy: number
  navigationTimeout: number
  proxyType?: number
  proxyFile?: string
  socks5Urls?: string[]
  socks4Urls?: string[]
  testUrls?: string[]
  testTimeout?: number
  maxConcurrentTests?: number
  testCount?: number
  rotationEnabled?: boolean
  verbose?: boolean
  keepAliveEnabled?: boolean
  keepAliveInterval?: number
  keepAliveUrls?: string[]
}

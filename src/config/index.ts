/**
 * CONFIGURATION MODULE
 * Manages bot settings and environment variables
 */

import { logger } from "../utils/logger"
import * as path from "path"
import * as dotenv from "dotenv"
import { defaultConfig } from "./defaults"

export { defaultConfig }

export interface Config {
  levelinfEmail: string
  levelinfPassword: string
  useProxy: number
  proxyFile: string
  socks5Urls: string[]
  socks4Urls: string[]
  proxyTestCount: number
  proxyTimeout: number
  proxyMaxConcurrentTests: number
  proxyKeepAliveEnabled: boolean
  proxyKeepAliveInterval: number
  proxyKeepAliveUrls: string[]
  enableClientCertificates: boolean
  enableSecureConnection: boolean
  privateKeyPath?: string
  certificatePath?: string
  caCertificatePath?: string
  allowedNetworks: string[]
  blockedNetworks: string[]
  disableCountryDropdown: boolean
  enableAgeConfirmation: boolean
  logLevel: number
  enableFileLogging: boolean
  logFilePath: string
  enableLogColors: boolean
  viewportWidth: number
  viewportHeight: number
  userAgent: string
  pageLoadTimeout: number
  elementWaitTimeout: number
  actionDelay: number
  maxEmailCheckAttempts: number
  emailCheckInterval: number
  smartEmailCheck: boolean
  debugMode: boolean
  screenshotOnError: boolean
  headless: boolean
  levelinfBaseUrl: string
  referralCode: string
  navigationTimeout: number
  continuousMode: boolean
  maxContinuousSessions: number
  inactivityTimeout: number
}

export class ConfigurationManager {
  private static instance: ConfigurationManager
  private config: Config

  private constructor() {
    dotenv.config()
    this.config = this.initialize()
  }

  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager()
    }
    return ConfigurationManager.instance
  }

  private initialize(): Config {
    const config = { ...defaultConfig }

    if (process.env.LEVELINF_EMAIL) config.levelinfEmail = process.env.LEVELINF_EMAIL
    if (process.env.LEVELINF_PASSWORD) config.levelinfPassword = process.env.LEVELINF_PASSWORD
    if (process.env.REFERRAL_CODE) config.referralCode = process.env.REFERRAL_CODE

    const projectRoot = path.resolve(__dirname, "../..")

    if (config.proxyFile && !path.isAbsolute(config.proxyFile)) {
      config.proxyFile = path.resolve(projectRoot, config.proxyFile)
    }

    if (config.logFilePath && !path.isAbsolute(config.logFilePath)) {
      config.logFilePath = path.resolve(projectRoot, config.logFilePath)
    }

    if (![0, 1, 2, 3, 4, 5].includes(config.useProxy)) {
      logger.warn("Invalid proxy setting, defaulting to 0")
      config.useProxy = 0
    }

    return config
  }

  getConfig(): Config {
    return this.config
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key]
  }

  set<K extends keyof Config>(key: K, value: Config[K]): void {
    this.config[key] = value
  }
}

export function loadConfig(): Config {
  return ConfigurationManager.getInstance().getConfig()
}

/**
 * Crossfire Legends Referral Bot
 * 
 * Automated referral registration bot for Crossfire Legends game.
 * Features:
 * - Automatic temporary email generation via GuerrillaMail
 * - Browser automation using Puppeteer Core
 * - Proxy support (HTTP, HTTPS, SOCKS4, SOCKS5)
 * - Automatic account registration and verification
 * - Multi-platform support (Windows, Linux, macOS, Android Termux)
 * 
 * @author mra1k3r0
 * @license MIT
 */

import { CrossfireReferralBot } from "./bot/crossfire-referral-bot"
import { loadConfig } from "./config"
import { logger } from "./utils/logger"
import { generateSecurePassword } from "./utils/helpers"
import type { RegistrationConfig } from "./types"

/**
 * Main entry point - initializes and runs the referral bot
 */
async function main() {
  const botConfig = loadConfig()
  const sessionPassword = generateSecurePassword()

  const config: RegistrationConfig = {
    email: botConfig.levelinfEmail,
    password: sessionPassword,
    referralCode: "abbqzbq",
  }

  logger.success("Starting Crossfire Referral Automation")
  logger.debug(`Email: ${config.email}`)
  logger.debug(`Password: ${"*".repeat(config.password.length)} (${config.password.length} chars, secure)`)

  const bot = new CrossfireReferralBot(config)
  await bot.run()

  logger.success("Automation completed!")
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.debug("Received SIGINT, shutting down gracefully...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  logger.debug("Received SIGTERM, shutting down gracefully...")
  process.exit(0)
})

// Run the bot
main().catch((error) => {
  logger.error(`Bot execution failed: ${error}`)
  process.exit(1)
})

export { CrossfireReferralBot } from "./bot/crossfire-referral-bot"
export { ProxyManager } from "./proxy/proxy-manager"
export { QuantumProxyManager } from "./proxy/quantum-proxy-manager"
export { SecureConnectionManager } from "./proxy/secure-connection-manager"
export { EmailService } from "./services/email-service"
export { loadConfig, Config } from "./config"
export { logger, Logger, LogLevel, createLogger } from "./utils/logger"
export * from "./types"
export * from "./utils/helpers"

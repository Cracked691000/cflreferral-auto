import { CrossfireReferralBot } from "./bot/crossfire-referral-bot"
import { loadConfig } from "./config"
import { logger } from "./utils/logger"
import { generateSecurePassword } from "./utils/helpers"
import type { RegistrationConfig } from "./types"

async function main() {
  const botConfig = loadConfig()
  const sessionPassword = generateSecurePassword()

  const config: RegistrationConfig = {
    email: botConfig.levelinfEmail,
    password: sessionPassword,
    referralCode: "abbqzbq",
  }

  logger.info("Starting Crossfire Referral Automation")
  logger.info(`Email: ${config.email}`)
  logger.info(`Password: ${"*".repeat(config.password.length)} (${config.password.length} chars, secure)`)

  const bot = new CrossfireReferralBot(config)
  await bot.run()

  logger.success("Automation completed!")
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully...")
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

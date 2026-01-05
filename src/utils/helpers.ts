import * as fs from "fs"
import * as path from "path"
import { logger } from "./logger"

/**
 * Generates human-like username for email registration
 * @returns Random username in format: firstName_randomSuffix
 */
export function generateHumanUsername(): string {
  const firstNames = [
    "john",
    "mike",
    "alex",
    "david",
    "chris",
    "steve",
    "tom",
    "james",
    "paul",
    "mark",
    "ryan",
    "kevin",
    "jason",
    "brian",
    "eric",
    "adam",
    "nick",
    "danny",
    "rob",
    "matt",
    "luke",
    "jake",
    "sam",
    "brandon",
  ]

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)]
  const suffixLength = Math.floor(Math.random() * 3) + 3
  let suffix = ""
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"

  for (let i = 0; i < suffixLength; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return `${firstName}_${suffix}`
}

/**
 * Generates secure random password with mixed characters
 * @returns Password string (8-10 characters) with uppercase, lowercase, numbers, and symbols
 */
export function generateSecurePassword(): string {
  const length = Math.floor(Math.random() * 3) + 8
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const lowercase = "abcdefghijklmnopqrstuvwxyz"
  const numbers = "0123456789"
  const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?"

  const password = [
    uppercase[Math.floor(Math.random() * uppercase.length)],
    lowercase[Math.floor(Math.random() * lowercase.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ]

  const allChars = uppercase + lowercase + numbers + symbols
  for (let i = 4; i < length; i++) {
    password.push(allChars[Math.floor(Math.random() * allChars.length)])
  }

  for (let i = password.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[password[i], password[j]] = [password[j], password[i]]
  }

  return password.join("")
}

/**
 * Saves successful account credentials to valid.txt
 * @param email - Account email address
 * @param password - Account password
 */
export function saveSuccessfulAccount(email: string, password: string): void {
  const validFilePath = path.join(process.cwd(), "valid.txt")
  const accountLine = `${email}|${password}\n`

  try {
    if (!fs.existsSync(validFilePath)) {
      fs.writeFileSync(validFilePath, "")
    }

    const existingContent = fs.readFileSync(validFilePath, "utf-8")

    if (existingContent.includes(`${email}|`)) {
      logger.info(`ℹ️  Account ${email} already exists in valid.txt`)
      return
    }

    fs.appendFileSync(validFilePath, accountLine)
    logger.success(`Account saved to valid.txt: ${email}`)
  } catch (error) {
    logger.error(`Failed to save account to valid.txt: ${error}`)
  }
}

/**
 * Creates a delay promise
 * @param ms - Milliseconds to delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a random delay between min and max milliseconds
 * @param min - Minimum delay in milliseconds
 * @param max - Maximum delay in milliseconds
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return delay(ms)
}

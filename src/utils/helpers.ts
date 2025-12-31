import * as fs from "fs"
import * as path from "path"
import { logger } from "./logger"

/**
 * Generate human-like usernames for email registration
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

  const suffixLength = Math.floor(Math.random() * 3) + 3 // 3-5 characters
  let suffix = ""
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"

  for (let i = 0; i < suffixLength; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return `${firstName}_${suffix}`
}

/**
 * Generate secure random password
 */
export function generateSecurePassword(): string {
  const length = Math.floor(Math.random() * 3) + 8 // 8-10 characters
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const lowercase = "abcdefghijklmnopqrstuvwxyz"
  const numbers = "0123456789"
  const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?"

  // Ensure at least one character from each category
  const password = [
    uppercase[Math.floor(Math.random() * uppercase.length)],
    lowercase[Math.floor(Math.random() * lowercase.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ]

  // Fill the rest randomly
  const allChars = uppercase + lowercase + numbers + symbols
  for (let i = 4; i < length; i++) {
    password.push(allChars[Math.floor(Math.random() * allChars.length)])
  }

  // Shuffle the password array
  for (let i = password.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[password[i], password[j]] = [password[j], password[i]]
  }

  return password.join("")
}

/**
 * Save successful account to valid.txt
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
      console.log(`ℹ️  Account ${email} already exists in valid.txt`)
      return
    }

    fs.appendFileSync(validFilePath, accountLine)
    logger.success(`Account saved to valid.txt: ${email}`)
  } catch (error) {
    logger.error(`Failed to save account to valid.txt: ${error}`)
  }
}

/**
 * Delay utility with optional logging
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Random delay between min and max milliseconds
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return delay(ms)
}

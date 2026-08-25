/**
 * Centralized password validation.
 * Enforces strong password requirements across all password-setting flows.
 */

export type PasswordValidation = {
  valid: boolean;
  errors: string[];
  strength: "weak" | "medium" | "strong" | "very-strong";
  score: number; // 0-100
};

const COMMON_PASSWORDS = new Set([
  "password", "12345678", "qwerty123", "abc12345", "password123",
  "admin123", "letmein", "welcome1", "monkey123", "dragon123",
  "master123", "111111111", "iloveyou", "sunshine1", "princess1",
]);

/**
 * Validate password strength. Requires:
 * - At least 8 characters
 * - Not a common password
 * - Contains uppercase, lowercase, digit
 * - Bonus: special char, 12+ chars
 */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];
  let score = 0;

  if (!password || password.length < 8) {
    errors.push("Password must be at least 8 characters long.");
  } else {
    score += 20;
    if (password.length >= 12) score += 15;
    if (password.length >= 16) score += 10;
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Must contain at least one uppercase letter (A-Z).");
  } else {
    score += 15;
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Must contain at least one lowercase letter (a-z).");
  } else {
    score += 15;
  }

  if (!/\d/.test(password)) {
    errors.push("Must contain at least one number (0-9).");
  } else {
    score += 15;
  }

  if (/[!@#$%^&*(),.?":{}|<>_\-+=/\\[\]]/.test(password)) {
    score += 10; // Bonus for special char
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push("This password is too common. Please choose a unique password.");
    score = Math.min(score, 20);
  }

  // Simple pattern detection
  if (/^(.)\1+$/.test(password)) {
    errors.push("Password cannot be all the same character.");
    score = 10;
  }

  if (/^(0123|1234|abcd|qwer)/i.test(password)) {
    errors.push("Password cannot start with a common sequence.");
    score = Math.min(score, 30);
  }

  score = Math.min(score, 100);

  let strength: PasswordValidation["strength"] = "weak";
  if (score >= 80) strength = "very-strong";
  else if (score >= 60) strength = "strong";
  else if (score >= 40) strength = "medium";

  return {
    valid: errors.length === 0,
    errors,
    strength,
    score,
  };
}
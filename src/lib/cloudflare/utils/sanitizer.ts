/**
 * Utility functions for sanitizing and formatting AI responses.
 * @module Sanitizer
 */

export function cleanJsonOutput(text: string): string {
    // Remove markdown code fences if present
    return text.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
}

export function sanitizeAndFormatResponse(text: string): string {
    // Basic sanitization (replace with a real sanitizer if needed)
    // For CLI purposes, we might just return text or use simple replacements
    // In a real web app, we'd use DOMPurify
    return text; // Placeholder for now
}

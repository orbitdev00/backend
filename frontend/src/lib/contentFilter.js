// Content filter — blocks slurs, spam, images

const SLURS = [
  'nigger','nigga','chink','spic','kike','faggot','tranny','wetback',
  'gook','towelhead','raghead','coon','jigaboo','cracker','beaner',
  'zipperhead','sandnigger','redskin','gyp','paki'
]

const SPAM_PATTERN = /(.)\1{6,}/i  // same char 7+ times in a row
const WORD_SPAM    = /\b(\w+)(\s+\1){4,}\b/i  // same word 5+ times
const IMAGE_PATTERN = /(https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|heic)(\?\S*)?)|(<img\s)|(\[img\])/i
const URL_PATTERN  = /https?:\/\/[^\s]+/gi
const XSS_PATTERN  = /<\s*(script|iframe|object|embed|form|input|svg|math)[^>]*>|javascript\s*:|on\w+\s*=/i

export function filterContent(text) {
  const lower = text.toLowerCase()

  // Check slurs
  for (const slur of SLURS) {
    const regex = new RegExp(`\\b${slur}s?\\b`, 'i')
    if (regex.test(lower)) {
      return { blocked: true, reason: 'Your post contains prohibited language.' }
    }
  }

  // Check XSS attempts
  if (XSS_PATTERN.test(text)) {
    return { blocked: true, reason: 'Your post contains disallowed HTML or script content.' }
  }

  // Check character spam
  if (SPAM_PATTERN.test(text)) {
    return { blocked: true, reason: 'Your post contains character spam.' }
  }

  // Check word spam
  if (WORD_SPAM.test(text)) {
    return { blocked: true, reason: 'Your post contains repeated word spam.' }
  }

  // Check images
  if (IMAGE_PATTERN.test(text)) {
    return { blocked: true, reason: 'Images are not allowed in forum posts.' }
  }

  // Strip any URLs from display (allow text links but not image embeds)
  return { blocked: false }
}

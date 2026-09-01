import exifr from 'exifr';

// Returns an ISO date string for when the photo was actually taken (EXIF
// DateTimeOriginal/CreateDate), or null if the file has no such metadata
// (e.g. a screenshot, or a PNG that typically carries no EXIF at all).
// Deliberately returns null rather than falling back to the upload/file
// date — that's a different fact and would just be mislabeled.
export async function extractTakenAt(filePath) {
  try {
    const data = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']);
    const date = data?.DateTimeOriginal ?? data?.CreateDate;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  } catch {
    return null;
  }
}

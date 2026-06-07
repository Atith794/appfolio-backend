import sharp from "sharp";
function escapeXml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
export async function generateCover({ title, subtitle, screenshotBuffer }) {
    const width = 1200;
    const height = 630;
    // Base background
    const base = sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 18, g: 18, b: 18 }
        }
    });
    // IMPORTANT: Ensure SVG itself is exactly width x height
    const safeTitle = escapeXml(title);
    const safeSubtitle = escapeXml(subtitle);
    const textSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#111827"/>
        <stop offset="100%" stop-color="#0b1220"/>
      </linearGradient>
    </defs>

    <rect width="100%" height="100%" fill="url(#g)"/>

    <text x="60" y="180"
      font-family="Inter, Arial, sans-serif"
      font-size="64"
      font-weight="800"
      fill="#ffffff">${safeTitle}</text>

    <text x="60" y="240"
      font-family="Inter, Arial, sans-serif"
      font-size="30"
      font-weight="500"
      fill="#a3a3a3">${safeSubtitle}</text>
  </svg>`;
    // Render SVG to a raster buffer with explicit dimensions (prevents oversize overlay)
    const textLayer = await sharp(Buffer.from(textSvg))
        .resize(width, height, { fit: "fill" })
        .png()
        .toBuffer();
    const layers = [
        { input: textLayer, top: 0, left: 0 }
    ];
    // Screenshot: resize into a safe box that fits inside the base
    if (screenshotBuffer) {
        const boxW = 420;
        const boxH = 420; // keep it safe; 840 can exceed height depending on placement
        const shot = await sharp(screenshotBuffer)
            .resize(boxW, boxH, { fit: "contain", background: { r: 18, g: 18, b: 18 } })
            .png()
            .toBuffer();
        // Ensure placement keeps entire overlay inside 1200x630
        layers.push({ input: shot, top: 160, left: 720 });
    }
    return base.composite(layers).jpeg({ quality: 90 }).toBuffer();
}

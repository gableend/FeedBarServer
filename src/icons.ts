import { FaviconExtractor } from "@iocium/favicon-extractor";

export async function getBestIcon(siteUrl: string): Promise<string | null> {
    try {
        const extractor = new FaviconExtractor();
        // This fetches the HTML and looks for apple-touch-icon, manifest, etc.
        const icons = await extractor.fetchAndExtract(siteUrl);
        
        if (!icons || icons.length === 0) {
            // Fallback: Try the standard /favicon.ico if nothing is in HTML
            const domain = new URL(siteUrl).origin;
            return `${domain}/favicon.ico`;
        }

        // 1. Prioritize Apple Touch Icons (usually 180x180)
        const appleIcon = icons.find(i => i.url.includes('apple-touch-icon'));
        if (appleIcon) return appleIcon.url;

        // 2. Look for large PNGs
        const largeIcon = icons.find(i => i.sizes && parseInt(i.sizes) >= 128);
        if (largeIcon) return largeIcon.url;

        // 3. Just take the first available one
        return icons[0].url;
    } catch (error) {
        console.error(`Icon fetch failed for ${siteUrl}:`, error);
        return null;
    }
}
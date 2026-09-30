# Branding splash images

The splash screen (`components/app/SplashScreen.tsx`) shows one of these two
images on a hard page load, holds it for ~2 seconds while the app loads
silently behind it, then blurs and fades it out.

Drop your files here with these exact names:

| File                    | Used when                                   |
| ----------------------- | ------------------------------------------- |
| `public/brand-portrait.png`  | viewport is taller than wide (phones held upright) |
| `public/brand-landscape.png` | viewport is wider than tall (desktop, landscape phones) |

Recommended: portrait ~1080×1920, landscape ~1920×1080, PNG or JPEG.

Until you add them, both images 404 and the splash shows a plain white screen
for the first 2 seconds — that is expected before you drop the files in.
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f67b51fc-4b03-49ca-b317-b4618b316005

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Multiplayer Notes

- `npm run dev` now starts both the Vite client on port `3000` and the multiplayer room server on port `3001`.
- Host a room from one browser tab, then open a second tab or another device on the same LAN and join with the generated room code.
- The host drives the `Carbon GT` and the joining player drives the new `Solaris XR`.

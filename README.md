# Arcana MR

A mixed-reality tarot reading for Meta Quest 3, built for the Quest Browser with
WebXR and Meta's [Immersive Web SDK](https://iwsdk.dev).

Put on the headset and a tarot deck appears on your real table. Pick a reading,
watch the deck shuffle and deal, flip the cards with your hands, and read what
each one reflects back to you.

Arcana MR is a tool for self-reflection, not fortune telling. Every card comes
with a short read and a question to sit with. Nothing here predicts the future.

## Progress

- [x] 0. Recon and defaults confirmed
- [x] 1. Scaffold (IWSDK, TypeScript, mixed reality)
- [x] 2. Architecture skeleton (config, reading state machine, deck and theme loaders)
- [ ] 3. Card data (78 cards, upright and reversed, with validator)
- [x] 4. Art pack (public-domain 1909 Rider-Waite-Smith)
- [ ] 5. Table placement
- [ ] 6. Menu, shuffle, deal
- [ ] 7. Flipping with hands and controllers
- [ ] 8. Meaning panels
- [ ] 9. Dark and gold theme
- [ ] 10. QA and performance
- [ ] 11. Deploy

## Run it

Requires Node 20.19 or newer.

```sh
npm install
npm run dev
```

`npm run dev` starts a local HTTPS server on port 8081 and opens a managed
browser with IWER, the IWSDK desktop XR emulator. Click **Enter XR** to try the
mixed-reality session on your desktop.

### On a Quest headset

1. Put the headset and your computer on the same Wi-Fi network.
2. Run `npx @iwsdk/cli dev status` and copy the `network` URL
   (for example `https://192.168.1.20:8081/`).
3. Open that URL in the Quest Browser and accept the certificate warning. The
   dev server uses a self-signed local certificate.
4. Tap **Enter XR**.

## License

The code is MIT licensed. The card meanings and reflection prompts, and any
original deck art, are not. See [LICENSE](LICENSE) for the details.

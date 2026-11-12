# Vendored web fonts

The web app vendors only the latin file it uses so `next build` does not make
network requests to Google Fonts.

- Inter variable normal: `@fontsource-variable/inter@5.2.8`, used for the whole
  interface (body, headings, figures and labels). Code uses the system
  monospace face.

The package publishes the Google Fonts binary under the SIL Open Font License
1.1, included here as `inter/OFL.txt`. Source package:

- https://www.npmjs.com/package/@fontsource-variable/inter/v/5.2.8

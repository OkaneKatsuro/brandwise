# @brandwise/email-engine

Optional engine of BrandWise for two things that need a heavy dependency tree: [MJML](https://mjml.io) (MIT) and a headless Chrome driven by `puppeteer-core`. The core never imports it; it starts one of these scripts as a child process.

| Script | What it does | Called by |
|---|---|---|
| `mjml.mjs` | compiles MJML to responsive, inlined HTML | the `Renderer` port in `packages/core/src/email/templates` |
| `shot.mjs` | takes a full-page PNG of an e-mail's HTML | the `PreviewService` port in the same folder |
| `look.mjs` | renders a company's page for `bb brandwise research look`: a PNG of the top of the page, and what Chrome computed for the page's elements as JSON | `packages/core/src/context/chrome-render.ts` |

`look.mjs` renders a page that a stranger controls, so Chrome is fenced as a whole: the page's scripts are off, Chrome's own sandbox stays on, and Chrome reaches the network only through a proxy that the core starts for that one render and that refuses everything but public addresses on ports 80 and 443 (`packages/core/src/context/proxy.ts`). It only reads; which value is a candidate for what is decided, and tested, in `packages/core/src/context/look.ts`.

```
npm install            # in this folder
echo '<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-text></mj-column></mj-section></mj-body></mjml>' | node mjml.mjs
```

The plugin finds it through the setting `emailEnginePath` (set by `provision.sh apply` when `node_modules` exists here). The Chrome is the setting `chromePath`, else the Chrome Headless Shell of the video engine, else a Chrome installed on the machine.

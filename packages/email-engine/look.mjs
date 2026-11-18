#!/usr/bin/env node
// Renders a stranger's page in a Chrome the caller names, for the company's look: writes a PNG of the top of the page and prints,
// as JSON on stdout, what the browser computed for the page's elements.
//   node look.mjs <chrome binary> <address> <proxy port> <png file>
// The page is hostile until shown otherwise, so Chrome is fenced as a whole. The page's scripts are off. Chrome reaches the
// network only through the caller's proxy on 127.0.0.1, which lets nothing but public addresses pass; `<-loopback>` takes away
// Chrome's habit of reaching this machine and link-local addresses directly, so nothing goes around the proxy. And Chrome's own
// sandbox stays on, unlike in shot.mjs, which renders HTML of our own.
import puppeteer from "puppeteer-core";

const [executablePath, address, proxyPort, pngFile] = process.argv.slice(2);
/** The picture: this wide, and at most this many screens high. */
const WIDTH = 1440, HEIGHT = 900, SCREENS = 2;
/** How many elements of a kind are read, and how long a string of the page (a font stack, an address) may be. */
const LIMITS = { elements: 200, text: 2000 };

/**
 * Runs in the page. It reads and decides nothing: which of these values is the page's text colour or its main button is decided,
 * and tested, in packages/core/src/context/look.ts (`RenderedPage` there is what this returns, without `pageHeight`). Every list
 * is in the order of the page and bounded.
 */
function read({ elements, text }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const pixel = canvas.getContext("2d", { willReadFrequently: true });
  const painted = new Map();
  // A CSS colour as [red, green, blue, alpha], each 0 to 255. The browser is asked to paint it, so every notation it knows
  // (oklch(), color-mix(), a name) comes out the same way and none needs arithmetic of ours.
  const rgba = (css) => {
    if (!painted.has(css)) {
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = css;
      pixel.fillRect(0, 0, 1, 1);
      painted.set(css, CSS.supports("color", css) ? Array.from(pixel.getImageData(0, 0, 1, 1).data) : null);
    }
    return painted.get(css);
  };
  const backdrop = (el) => {
    for (let around = el.parentElement; around !== null; around = around.parentElement) {
      const background = rgba(getComputedStyle(around).backgroundColor);
      if (background !== null && background[3] === 255) return background;
    }
    return null;
  };
  const sample = (el) => {
    const style = getComputedStyle(el), box = el.getBoundingClientRect();
    return {
      color: rgba(style.color), background: rgba(style.backgroundColor), backdrop: backdrop(el), fontFamily: style.fontFamily.slice(0, text),
      top: Math.round(box.top + scrollY), shown: box.width > 0 && box.height > 0 && style.visibility === "visible",
    };
  };
  const all = (selector) => Array.from(document.querySelectorAll(selector)).slice(0, elements);
  const header = "header, [role=banner]";
  const inHeader = document.querySelector("header img, header svg, [role=banner] img, [role=banner] svg");
  return {
    url: location.href,
    screenHeight: innerHeight,
    pageHeight: document.documentElement.scrollHeight,
    html: sample(document.documentElement),
    body: document.body === null ? null : sample(document.body),
    paragraphs: all("p").map(sample),
    headings: all("h1, h2, h3").map((el) => ({ ...sample(el), level: Number(el.localName[1]) })),
    actions: all("button, input[type=submit], input[type=button], [role=button], a[href]").map((el) => ({
      ...sample(el), link: el.localName === "a", inHeader: el.closest(header) !== null, inParagraph: el.closest("p") !== null,
    })),
    icons: all("link[rel~=icon i]").map((el) => el.href.slice(0, text)),
    headerImage: inHeader === null ? null : inHeader.localName === "svg" ? { svg: true } : { src: (inHeader.currentSrc || inHeader.src).slice(0, text) },
    ogImage: document.querySelector("meta[property='og:image' i]")?.content.slice(0, text) ?? null,
  };
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath, headless: true,
    args: ["--disable-gpu", "--hide-scrollbars", `--proxy-server=http://127.0.0.1:${proxyPort}`, "--proxy-bypass-list=<-loopback>"],
  });
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  // the caller gives the whole render 30 seconds: starting Chrome, this, the fonts, the picture and closing have to fit
  const answer = await page.goto(address, { waitUntil: "load", timeout: 15_000 });
  // what Chrome was given is what counts: a site may answer a browser otherwise than it answered the caller's own request
  if (answer?.status() !== 200) throw new Error(`the page answered the browser with HTTP ${answer?.status() ?? "nothing"}`);
  // web fonts may still be on their way when the page has loaded: the picture waits for them, but not for long
  await Promise.race([page.evaluate(() => document.fonts.ready.then(() => null)).catch(() => null), new Promise((resolve) => setTimeout(resolve, 3000).unref())]);
  const { pageHeight, ...computed } = await page.evaluate(read, LIMITS);
  await page.screenshot({ path: pngFile, clip: { x: 0, y: 0, width: WIDTH, height: Math.max(1, Math.min(pageHeight, SCREENS * HEIGHT)) } });
  process.stdout.write(JSON.stringify(computed));
} catch (cause) {
  // one line for the caller, who reports it; a stack of this script says nothing to the person who gave the address
  process.stderr.write(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
} finally {
  await browser?.close();
}

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContextOptions, Locator, Page } from '@playwright/test';

// Records the short clips the screen tours play: the real app driven by a script, with a drawn
// mouse pointer (headless browsers have none) so the clip shows what is clicked. Frames come from
// Chromium's screencast and ffmpeg turns them into a looping GIF.

// A laptop screen, sized so the screen beside the sidebar is exactly a clip's shape.
export const VIEWPORT = { width: 1280, height: 698 };
/** Every clip has this shape, so the tour's tooltip can keep room for it before it loads. */
const ASPECT = 16 / 10;
const OUT_WIDTH = 640;
const FPS = 10;

type Box = { x: number; y: number; width: number; height: number };

/** A drawn pointer that follows the mouse and rings where it clicks; tours and the ? button hidden. */
function decorate() {
  try {
    localStorage.setItem('pos_tours_off', '1');
  } catch {
    // The clip shows the tour's own button then; harmless.
  }
  const install = () => {
    const style = document.createElement('style');
    style.textContent = `
      [data-tour="help-button"] { display: none !important; }
      #clip-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transform: translate(-60px, -60px); }
      .clip-click { position: fixed; z-index: 2147483646; pointer-events: none; width: 36px; height: 36px; margin: -18px 0 0 -18px;
        border-radius: 9999px; border: 3px solid #2548e0; background: rgba(37, 72, 224, 0.18); animation: clip-click 600ms ease-out forwards; }
      @keyframes clip-click { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'clip-cursor';
    cursor.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 2.5 19 13l-6.2 1.2-3.6 6.3z" fill="#0b1324" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    document.addEventListener('mousemove', (event) => {
      cursor.style.transform = `translate(${event.clientX - 5}px, ${event.clientY - 3}px)`;
    }, true);
    document.addEventListener('mousedown', (event) => {
      const ring = document.createElement('div');
      ring.className = 'clip-click';
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 700);
    }, true);
  };
  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
}

/** Where the pointer is, so each move glides on from there. */
const pointerAt = new WeakMap<Page, { x: number; y: number }>();

export async function glideTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`Not on screen: ${target}`);
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = pointerAt.get(page) ?? { x: VIEWPORT.width / 2, y: VIEWPORT.height - 40 };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  await page.mouse.move(to.x, to.y, { steps: Math.max(8, Math.min(30, Math.round(distance / 25))) });
  pointerAt.set(page, to);
}

/** Moves to the element, pauses so the eye follows, and clicks it. */
export async function clickOn(page: Page, target: Locator, pause = 350) {
  await glideTo(page, target);
  await page.waitForTimeout(250);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(pause);
}

/** Clicks into a field and types over what's in it, at a readable pace. */
export async function typeInto(page: Page, target: Locator, text: string) {
  await clickOn(page, target, 150);
  await page.keyboard.press('ControlOrMeta+A');
  await target.pressSequentially(text, { delay: 85 });
  await page.waitForTimeout(300);
}

/** A select's option, picked with a visible click on the select. */
export async function chooseIn(page: Page, target: Locator, option: string | { label: string }) {
  await clickOn(page, target, 150);
  await target.selectOption(option);
  await page.waitForTimeout(400);
}

/** The boxes of these elements together, widened by `pad`. */
export async function areaOf(locators: Locator[], pad = 16): Promise<Box> {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.boundingBox();
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) throw new Error('No element to frame');
  const left = Math.min(...boxes.map((b) => b.x)) - pad;
  const top = Math.min(...boxes.map((b) => b.y)) - pad;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The screen beside the sidebar, below the header. */
export const MAIN_AREA: Box = { x: 240, y: 48, width: VIEWPORT.width - 240, height: VIEWPORT.height - 48 };

/** Grows the area to the clips' shape around its middle, kept inside the window, in even pixels. */
function frame(area: Box): Box {
  let { width, height } = area;
  if (width / height > ASPECT) height = width / ASPECT;
  else width = height * ASPECT;
  width = Math.min(width, VIEWPORT.width);
  height = Math.min(height, VIEWPORT.height, width / ASPECT);
  width = height * ASPECT;
  const centreX = area.x + area.width / 2;
  const centreY = area.y + area.height / 2;
  const x = Math.max(0, Math.min(VIEWPORT.width - width, centreX - width / 2));
  const y = Math.max(0, Math.min(VIEWPORT.height - height, centreY - height / 2));
  const even = (n: number) => Math.floor(n / 2) * 2;
  return { x: even(x), y: even(y), width: even(width), height: even(height) };
}

export type Clip = {
  /** The GIF's file name, as a tour step names it. */
  name: string;
  /** Opens the screen and gets it ready; not recorded. Returns the area to show. */
  setup: (page: Page) => Promise<Box>;
  /** What the clip shows. */
  act: (page: Page) => Promise<void>;
};

/**
 * Records a clip into `outDir/<name>.gif`, in a new browser context (signed in through
 * `storageState`). Returns that context's storage afterwards, for a later clip to start from.
 */
export async function record(browser: Browser, outDir: string, clip: Clip, storageState?: BrowserContextOptions['storageState']) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, storageState });
  await context.addInitScript(decorate);
  const page = await context.newPage();
  const area = frame(await clip.setup(page));
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 40);
  pointerAt.delete(page);
  await page.waitForTimeout(300);

  const frames: Array<{ data: Buffer; at: number }> = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (event) => {
    frames.push({ data: Buffer.from(event.data, 'base64'), at: event.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  await page.waitForTimeout(600);
  await clip.act(page);
  await page.waitForTimeout(1200);
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');

  toGif(frames, end, area, join(outDir, `${clip.name}.gif`));
  const state = await context.storageState();
  await context.close();
  return state;
}

function toGif(frames: Array<{ data: Buffer; at: number }>, end: number, area: Box, out: string) {
  if (frames.length === 0) throw new Error(`No frames recorded for ${out}`);
  const dir = mkdtempSync(join(tmpdir(), 'tour-clip-'));
  try {
    // The screencast sends a frame when the screen changes: each shows until the next.
    const list: string[] = [];
    frames.forEach((frame, index) => {
      const file = join(dir, `${String(index).padStart(5, '0')}.png`);
      writeFileSync(file, frame.data);
      const until = index + 1 < frames.length ? frames[index + 1].at : end;
      list.push(`file '${file}'`, `duration ${Math.max(0.02, until - frame.at).toFixed(3)}`);
    });
    // The concat list repeats its last file, or its duration is dropped.
    list.push(`file '${join(dir, `${String(frames.length - 1).padStart(5, '0')}.png`)}'`);
    writeFileSync(join(dir, 'frames.txt'), list.join('\n'));
    const crop = `crop=${area.width}:${area.height}:${area.x}:${area.y}`;
    const scale = `scale=${OUT_WIDTH}:-2:flags=lanczos`;
    mkdirSync(join(out, '..'), { recursive: true });
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
      '-vf', `${crop},${scale},fps=${FPS},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0',
      out
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

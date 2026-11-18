// The built-in styles, chosen for technical founders who do their own marketing. They are code and not files read at run time: the
// plugin is bundled and cannot find files beside its bundle.
import type { Style } from "../domain.ts";
import { beforeAfter } from "./before-after.ts";
import { buildInPublic } from "./build-in-public.ts";
import { changelogPost } from "./changelog-post.ts";
import { customerQuote } from "./customer-quote.ts";
import { featureCard } from "./feature-card.ts";
import { founderOnCamera } from "./founder-on-camera.ts";
import { launchAnnouncement } from "./launch-announcement.ts";
import { meme } from "./meme.ts";
import { productHero } from "./product-hero.ts";
import { productScreen } from "./product-screen.ts";

export const BUILTIN_STYLES: Style[] = [productHero, productScreen, launchAnnouncement, featureCard, changelogPost, buildInPublic, founderOnCamera, customerQuote, beforeAfter, meme];

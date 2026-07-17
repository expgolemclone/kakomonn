import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

globalThis.gsap = gsap;
globalThis.ScrollTrigger = ScrollTrigger;

import("./main.js").catch((error) => {
  window.setTimeout(() => {
    throw error;
  });
});

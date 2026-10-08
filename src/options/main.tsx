import { h, render } from "preact";

import { App } from "./App";

function attachStylesheet(href: string) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

attachStylesheet(new URL("../shared/theme.css", import.meta.url).href);
attachStylesheet(new URL("./options.css", import.meta.url).href);

const root = document.getElementById("app");
if (root) {
  render(h(App, null), root);
}

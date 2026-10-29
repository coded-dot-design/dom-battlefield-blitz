// Structured data (JSON-LD) for the pages. Facts already on the page only: names, copy, version,
// author, licence, links. No ratings, counts or quotes.
import { VERSION, BATTLEFIELD, base } from "./site";

type Ld = Record<string, unknown>;
const url = (site: URL | undefined, path = "") => new URL(base(path), site).href;
const author = { "@type": "Person", name: "Chris Cooley", url: "https://coded.design/" };

// The site and the game, for the landing page.
export function homeLd(site: URL | undefined, description: string): Ld {
  const home = url(site);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${home}#website`, name: "Battlefield Blitz", url: home, inLanguage: "en" },
      {
        "@type": "VideoGame",
        "@id": `${home}#game`,
        name: "Battlefield Blitz",
        url: home,
        description,
        image: url(site, "shots/og.png"),
        author,
        creator: author,
        publisher: { "@type": "Organization", name: "coded.design", url: "https://coded.design/" },
        gamePlatform: "Web browser",
        applicationCategory: "Game",
        softwareVersion: VERSION,
        license: "https://opensource.org/licenses/MIT",
        isBasedOn: { "@type": "VideoGame", name: "DOM Battlefield", url: BATTLEFIELD },
        potentialAction: { "@type": "PlayAction", target: url(site, "play/") },
      },
    ],
  };
}

// The play page: a page about the game, one level under the landing page.
export function playLd(site: URL | undefined, name: string, description: string): Ld {
  const home = url(site);
  const play = url(site, "play/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": play, url: play, name, description, inLanguage: "en", isPartOf: { "@type": "WebSite", "@id": `${home}#website`, name: "Battlefield Blitz", url: home },
        about: { "@type": "VideoGame", "@id": `${home}#game`, name: "Battlefield Blitz", url: home } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Battlefield Blitz", item: home },
          { "@type": "ListItem", position: 2, name: "Play", item: play },
        ],
      },
    ],
  };
}

// Safe inside <script>: no "</script>" can close the block early.
export const ldJson = (ld: Ld) => JSON.stringify(ld).replace(/</g, "\\u003c");

import type { APIRoute } from "astro";
import skillMd from "../../docs/SKILL.md?raw";

export const GET: APIRoute = () =>
  new Response(skillMd, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });

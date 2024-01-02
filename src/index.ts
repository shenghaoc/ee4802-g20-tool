// src/templates/populated-worker/src/index.ts
import renderHtml from "./renderHtml";
var src_default = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { DB } = env;
    const stmt = DB.prepare("SELECT * FROM comments LIMIT 3");
    const { results } = await stmt.all();
    return new Response(
      renderHtml(JSON.stringify(results, null, 2)),
      {
        headers: {
          "content-type": "text/html"
        }
      }
    );
  }
};
export {
  src_default as default
};

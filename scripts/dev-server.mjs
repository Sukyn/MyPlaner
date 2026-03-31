import { createReadStream } from "node:fs";
import { watch } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import {
  buildSite,
  createPlannerItem,
  createPlannerProject,
  deletePlannerItem,
  fileExists
} from "./planner-data.mjs";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT || 4173);
let buildQueue = Promise.resolve();

await buildAndLog();
startWatcher();
startServer();

async function buildAndLog() {
  const result = await queueBuild();
  console.log(
    `[planner] rebuilt ${result.plannerData.days.length} days into ${result.distDir}`
  );

  return result;
}

function queueBuild() {
  const nextBuild = buildQueue.catch(() => undefined).then(() => buildSite({ rootDir }));
  buildQueue = nextBuild;
  return nextBuild;
}

function startWatcher() {
  const watchedPaths = [path.join(rootDir, "todolist"), path.join(rootDir, "src")];
  let rebuildTimer = null;

  for (const target of watchedPaths) {
    watchPath(target);
  }

  async function watchPath(target) {
    try {
      for await (const _event of watch(target, { recursive: true })) {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(async () => {
          try {
            await buildAndLog();
          } catch (error) {
            console.error("[planner] rebuild failed");
            console.error(error);
          }
        }, 120);
      }
    } catch (error) {
      console.error(`[planner] watcher failed for ${target}`);
      console.error(error);
    }
  }
}

function startServer() {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (request.method === "POST" && pathname === "/api/items/delete") {
      await handleDeleteItemRequest(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/items/create") {
      await handleCreateItemRequest(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/projects/create") {
      await handleCreateProjectRequest(request, response);
      return;
    }

    if (pathname.startsWith("/api/")) {
      const statusCode = request.method === "POST" ? 404 : 405;
      response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(
        JSON.stringify({
          ok: false,
          error:
            statusCode === 405
              ? `Unsupported method for ${pathname}.`
              : `Unknown API route: ${pathname}.`
        })
      );
      return;
    }

    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const assetPath = path.join(distDir, relativePath);
    const fallbackPath = path.join(distDir, "index.html");
    const hasExtension = path.extname(relativePath).length > 0;

    if (!fileExists(assetPath) && pathname !== "/" && hasExtension) {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end("Not found");
      return;
    }

    const selectedPath = fileExists(assetPath) ? assetPath : fallbackPath;

    response.writeHead(200, {
      "Content-Type": contentTypeFor(selectedPath),
      "Cache-Control": "no-store"
    });

    createReadStream(selectedPath).pipe(response);
  });

  server.listen(port, () => {
    console.log(`[planner] http://localhost:${port}`);
  });
}

async function handleDeleteItemRequest(request, response) {
  try {
    const payload = await readJsonBody(request);
    const deleted = await deletePlannerItem({
      rootDir,
      sourceInfo: payload?.sourceInfo
    });
    const result = await buildAndLog();

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        ok: true,
        deleted,
        plannerData: result.plannerData
      })
    );
  } catch (error) {
    response.writeHead(400, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Delete request failed."
      })
    );
  }
}

async function handleCreateItemRequest(request, response) {
  try {
    const payload = await readJsonBody(request);
    const createdItem = await createPlannerItem({
      rootDir,
      item: payload?.item
    });
    const result = await buildAndLog();

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        ok: true,
        item: createdItem,
        plannerData: result.plannerData
      })
    );
  } catch (error) {
    response.writeHead(400, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Item creation failed."
      })
    );
  }
}

async function handleCreateProjectRequest(request, response) {
  try {
    const payload = await readJsonBody(request);
    const createdProject = await createPlannerProject({
      rootDir,
      project: payload?.project
    });
    const result = await buildAndLog();

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        ok: true,
        project: createdProject,
        plannerData: result.plannerData
      })
    );
  } catch (error) {
    response.writeHead(400, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Project creation failed."
      })
    );
  }
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body ? JSON.parse(body) : {};
}

function contentTypeFor(filepath) {
  const extension = path.extname(filepath);

  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "text/plain; charset=utf-8";
  }
}

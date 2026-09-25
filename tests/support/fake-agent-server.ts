/**
 * A stand-in for AssemblyAI over the network: the token route, the Voice Agent WebSocket, and any
 * pages a test wants served — so a real browser, or the real extension, can run a whole call
 * against it with nothing leaving the machine.
 *
 * It records every frame each socket sends (audio aside) and lets the test play the agent's side
 * with `serve(socket, frame)`.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

import { fakeUnderstanding } from "../../tools/replay/fake-understand";

export type Frame = { type: string; [key: string]: unknown };

export type Page = { html: string; headers?: Record<string, string> };

export type FakeAgentServer = {
  port: number;
  /** Every socket that connected, in order. */
  sockets: WebSocket[];
  /** What each socket sent, in order, audio frames left out. */
  received: Frame[][];
  /** How many tokens have been handed out. */
  tokens: () => number;
  /** How many times the site's model route was asked what a form means. */
  understood: () => number;
  /** Send the agent's side of the conversation down one socket. */
  serve: (socket: number, frame: unknown) => void;
  close: () => Promise<void>;
};

/** `pages` maps a path prefix ("/form") to what to serve there. */
export async function startFakeAgentServer(pages: Record<string, Page> = {}): Promise<FakeAgentServer> {
  const sockets: WebSocket[] = [];
  const received: Frame[][] = [];
  let tokens = 0;
  let understood = 0;
  // The site's meaning route, standing in for the model: certain of what the offline keys read.
  const understand = fakeUnderstanding();

  const server: Server = createServer((req, res) => {
    if (req.url?.startsWith("/api/voice-token")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: `tok-${++tokens}` }));
      return;
    }
    if (req.url?.startsWith("/api/understand") && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        understood++;
        const answer = await understand(JSON.parse(body || "{}"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...answer, model: "fake" }));
      });
      return;
    }
    const match = Object.keys(pages)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => req.url?.startsWith(prefix));
    if (match) {
      const page = pages[match]!;
      res.writeHead(200, { "content-type": "text/html", ...page.headers });
      res.end(page.html);
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: "/v1/ws" });
  wss.on("connection", (socket) => {
    const index = sockets.push(socket) - 1;
    received[index] = [];
    socket.on("message", (data) => {
      const frame = JSON.parse(String(data)) as Frame;
      if (frame.type === "input.audio") return;
      received[index]!.push(frame);
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    sockets,
    received,
    tokens: () => tokens,
    understood: () => understood,
    serve: (socket, frame) => sockets[socket]!.send(JSON.stringify(frame)),
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.terminate();
        wss.close();
        server.close(() => done());
      }),
  };
}

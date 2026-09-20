import { expect, test } from "@playwright/test";
import { byLabel, load, read, readDeep } from "./helpers";

/**
 * Shadow roots, iframes, portals, and forms that have not drawn yet.
 *
 * `querySelectorAll` stops at the first two, portals move the interesting parts somewhere else
 * entirely, and the fourth means the page you read is not the page that exists a second later.
 * An earlier project of ours found ONE element on a page that really had seven, for exactly
 * these reasons, which is why each one gets its own tests rather than a shared assumption.
 */

test.describe("shadow DOM", () => {
  test("a field inside an open shadow root is found", async ({ page }) => {
    await load(page, `<div id="host"></div>`);
    await page.evaluate(() => {
      document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML =
        `<label for="a">Inside</label><input id="a">`;
    });
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("fields in the light DOM and a shadow root are both found", async ({ page }) => {
    await load(page, `<label for="out">Outside</label><input id="out"><div id="host"></div>`);
    await page.evaluate(() => {
      document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML =
        `<label for="a">Inside</label><input id="a">`;
    });
    const result = await read(page);
    expect(result.specs).toHaveLength(2);
    expect(byLabel(result, "Outside")).toBeTruthy();
    expect(byLabel(result, "Inside")).toBeTruthy();
  });

  test("a shadow root nested inside another shadow root is reached", async ({ page }) => {
    await load(page, `<div id="host"></div>`);
    await page.evaluate(() => {
      const outer = document.getElementById("host")!.attachShadow({ mode: "open" });
      outer.innerHTML = `<div id="inner-host"></div>`;
      outer.getElementById("inner-host")!.attachShadow({ mode: "open" }).innerHTML =
        `<label for="deep">Two levels down</label><input id="deep">`;
    });
    expect(byLabel(await read(page), "Two levels down")).toBeTruthy();
  });

  test("a CLOSED shadow root is genuinely unreachable, and does not crash the read", async ({ page }) => {
    await load(page, `<label for="out">Outside</label><input id="out"><div id="host"></div>`);
    await page.evaluate(() => {
      document.getElementById("host")!.attachShadow({ mode: "closed" }).innerHTML =
        `<input id="a">`;
    });
    // One field, not two, and no exception. This is a documented limit, not a bug.
    expect((await read(page)).specs).toHaveLength(1);
  });

  test("three fields across three shadow hosts are all found", async ({ page }) => {
    await load(page, `<div id="h1"></div><div id="h2"></div><div id="h3"></div>`);
    await page.evaluate(() => {
      for (const id of ["h1", "h2", "h3"]) {
        document.getElementById(id)!.attachShadow({ mode: "open" }).innerHTML =
          `<label for="x">Field ${id}</label><input id="x">`;
      }
    });
    expect((await read(page)).specs).toHaveLength(3);
  });
});

test.describe("iframes", () => {
  test("a field inside a same-origin srcdoc iframe is found", async ({ page }) => {
    await load(page, `<iframe srcdoc='<label for="a">In a frame</label><input id="a">'></iframe>`);
    await page.waitForTimeout(150);
    expect(byLabel(await read(page), "In a frame")).toBeTruthy();
  });

  test("fields in the parent and in a frame are both found", async ({ page }) => {
    await load(
      page,
      `<label for="p">Parent field</label><input id="p">
       <iframe srcdoc='<label for="a">Frame field</label><input id="a">'></iframe>`,
    );
    await page.waitForTimeout(150);
    expect((await read(page)).specs).toHaveLength(2);
  });

  test("two frames each contribute their fields", async ({ page }) => {
    await load(
      page,
      `<iframe srcdoc='<label for="a">One</label><input id="a">'></iframe>
       <iframe srcdoc='<label for="b">Two</label><input id="b">'></iframe>`,
    );
    await page.waitForTimeout(200);
    expect((await read(page)).specs).toHaveLength(2);
  });

  test("a frame nested inside a frame is reached", async ({ page }) => {
    // Built with script rather than nested `srcdoc`, whose escaping is its own puzzle.
    await load(page, `<iframe id="outer"></iframe>`);
    await page.evaluate(() => {
      const outer = document.getElementById("outer") as HTMLIFrameElement;
      const doc = outer.contentDocument!;
      doc.body.innerHTML = `<iframe id="inner"></iframe>`;
      const inner = doc.getElementById("inner") as HTMLIFrameElement;
      inner.contentDocument!.body.innerHTML =
        `<label for="c">Two frames deep</label><input id="c">`;
    });
    await page.waitForTimeout(150);
    expect(byLabel(await read(page), "Two frames deep")).toBeTruthy();
  });

  test("a cross-origin frame is skipped without throwing", async ({ page }) => {
    await load(
      page,
      `<label for="p">Parent field</label><input id="p">
       <iframe src="https://example.com/"></iframe>`,
    );
    await page.waitForTimeout(300);
    // The parent's field still comes back. The frame's contents are simply not ours to read.
    expect(byLabel(await read(page), "Parent field")).toBeTruthy();
  });

  test("an empty frame contributes nothing and breaks nothing", async ({ page }) => {
    await load(page, `<label for="p">Parent</label><input id="p"><iframe></iframe>`);
    await page.waitForTimeout(150);
    expect((await read(page)).specs).toHaveLength(1);
  });
});

test.describe("React portals", () => {
  /**
   * A portal renders a dropdown's options as a child of `<body>`, structurally nowhere near the
   * field they belong to. Anything that looks inside the trigger's own container finds nothing,
   * which is why both the reader and the writer work by diffing what is on screen.
   */
  const PORTAL_SELECT = `
    <div role="button" aria-haspopup="listbox" aria-label="Seniority" id="trigger"
         style="width:180px;height:32px;border:1px solid #ccc">Choose…</div>
    <script>
      document.getElementById('trigger').addEventListener('pointerdown', () => {
        if (document.getElementById('portal')) return;
        const portal = document.createElement('div');
        portal.id = 'portal';
        portal.innerHTML =
          '<div role="option">Junior</div><div role="option">Mid</div><div role="option">Senior</div>';
        document.body.appendChild(portal);   // far from the trigger, exactly like Radix
      });
    </script>`;

  test("a portal dropdown is found as a field", async ({ page }) => {
    await load(page, PORTAL_SELECT);
    expect(byLabel(await read(page), "Seniority").kind).toBe("select");
  });

  test("its options are empty before it is opened", async ({ page }) => {
    await load(page, PORTAL_SELECT);
    expect(byLabel(await read(page), "Seniority").options).toBeUndefined();
  });

  test("harvesting opens it and collects the real options from the portal", async ({ page }) => {
    await load(page, PORTAL_SELECT);
    const spec = byLabel(await readDeep(page), "Seniority");
    expect(spec.options?.map((o) => o.label)).toEqual(["Junior", "Mid", "Senior"]);
  });

  test("the options are read even though they are nowhere near the trigger", async ({ page }) => {
    await load(page, PORTAL_SELECT);
    await readDeep(page);
    const parented = await page.evaluate(() => document.getElementById("portal")?.parentElement?.tagName);
    expect(parented).toBe("BODY");
  });

  test("a widget that only answers pointerdown still opens", async ({ page }) => {
    // Radix, and therefore shadcn/ui, registers pointerdown and never registers click.
    await load(page, PORTAL_SELECT);
    expect(byLabel(await readDeep(page), "Seniority").options?.length).toBe(3);
  });

  test("two portal dropdowns do not steal each other's options", async ({ page }) => {
    await load(
      page,
      `<div role="button" aria-haspopup="listbox" aria-label="First" id="t1" style="width:120px;height:30px">A</div>
       <div role="button" aria-haspopup="listbox" aria-label="Second" id="t2" style="width:120px;height:30px">B</div>
       <script>
         const open = (id, items) => document.getElementById(id).addEventListener('pointerdown', () => {
           document.querySelectorAll('.pop').forEach(n => n.remove());
           const p = document.createElement('div'); p.className = 'pop';
           p.innerHTML = items.map(i => '<div role="option">' + i + '</div>').join('');
           document.body.appendChild(p);
         });
         open('t1', ['Alpha', 'Beta']);
         open('t2', ['Gamma', 'Delta', 'Epsilon']);
       </script>`,
    );
    const result = await readDeep(page);
    expect(byLabel(result, "First").options?.map((o) => o.label)).toEqual(["Alpha", "Beta"]);
    expect(byLabel(result, "Second").options?.map((o) => o.label)).toEqual([
      "Gamma",
      "Delta",
      "Epsilon",
    ]);
  });
});

test.describe("forms that have not drawn yet", () => {
  test("a read taken too early sees nothing", async ({ page }) => {
    await load(
      page,
      `<div id="slot">Loading…</div>
       <script>setTimeout(() => {
         document.getElementById('slot').innerHTML = '<label for="late">Arrived late</label><input id="late">';
       }, 400);</script>`,
    );
    expect((await read(page)).specs).toHaveLength(0);
  });

  test("waiting for the page to settle finds it", async ({ page }) => {
    await load(
      page,
      `<div id="slot">Loading…</div>
       <script>setTimeout(() => {
         document.getElementById('slot').innerHTML = '<label for="late">Arrived late</label><input id="late">';
       }, 400);</script>`,
    );
    expect(byLabel(await readDeep(page), "Arrived late")).toBeTruthy();
  });

  test("settling gives up rather than hanging on a page that never goes quiet", async ({ page }) => {
    await load(
      page,
      `<label for="f">Present all along</label><input id="f">
       <div id="ticker"></div>
       <script>setInterval(() => {
         document.getElementById('ticker').textContent = String(Date.now());
       }, 50);</script>`,
    );
    const started = Date.now();
    const result = await readDeep(page);
    expect(Date.now() - started).toBeLessThan(9000);
    expect(byLabel(result, "Present all along")).toBeTruthy();
  });

  test("a field added after the read is simply not in that read", async ({ page }) => {
    await load(page, `<label for="a">First</label><input id="a">`);
    const before = await read(page);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", `<label for="b">Second</label><input id="b">`);
    });
    const after = await read(page);
    expect(before.specs).toHaveLength(1);
    expect(after.specs).toHaveLength(2);
  });
});

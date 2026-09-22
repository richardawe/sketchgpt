// A small drawing tool API. Model output never becomes SVG markup or code.
export const SKETCH_PROMPT = `Draw the user's request using JSON drawing tools. Return only a JSON object:
{"title":"Short description","commands":[{"tool":"circle","args":[200,180,70],"text":""}]}
Canvas is 400 by 400. Coordinates are 0 to 400. Use 3 to 12 simple black outline shapes, no shading. Keep shapes inside the canvas. Tools:
line: args [x1,y1,x2,y2]
circle: args [cx,cy,radius]
rectangle: args [x,y,width,height]
path: args [startX,startY,controlX,controlY,endX,endY] for a quadratic curve. You may append groups of [controlX,controlY,endX,endY].
text: args [x,y], text contains a short label.
Include text:"" for every non-text tool. No SVG, HTML, code, or explanation. Return a complete drawing on every turn, including when revising a previous sketch.`;

export const SKETCH_SCHEMA = JSON.stringify({
  type: "object", additionalProperties: false, required: ["title", "commands"],
  properties: {
    title: { type: "string", maxLength: 120 },
    commands: { type: "array", minItems: 1, maxItems: 40, items: {
      type: "object", additionalProperties: false, required: ["tool", "args", "text"],
      properties: {
        tool: { type: "string", enum: ["line", "circle", "rectangle", "path", "text"] },
        args: { type: "array", minItems: 2, maxItems: 50, items: { type: "number", minimum: 0, maximum: 400 } },
        text: { type: "string", maxLength: 80 }
      }
    } }
  }
});

const object = value => value && typeof value === "object" && !Array.isArray(value);
const only = (value, keys) => Object.keys(value).every(k => keys.includes(k));
export function parseSketch(raw) {
  if (typeof raw !== "string" || raw.length > 24000) throw new Error("Drawing is too large.");
  const data = JSON.parse(raw);
  if (!object(data) || !only(data, ["title", "commands"]) ||
      typeof data.title !== "string" || data.title.length > 120 ||
      !Array.isArray(data.commands) || !data.commands.length || data.commands.length > 40) {
    throw new Error("Invalid drawing.");
  }
  for (const c of data.commands) {
    if (!object(c) || !only(c, ["tool", "args", "text"]) ||
        typeof c.text !== "string" || c.text.length > 80 ||
        !Array.isArray(c.args) || c.args.length > 50 ||
        !c.args.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 400)) {
      throw new Error("Invalid drawing command.");
    }
    const a = c.args;
    const count = { line: 4, circle: 3, rectangle: 4, text: 2 };
    if (c.tool === "path") {
      if (a.length < 6 || (a.length - 2) % 4) throw new Error("Invalid curve.");
    } else if (!Object.hasOwn(count, c.tool) || a.length !== count[c.tool]) {
      throw new Error("Unknown tool or wrong coordinates.");
    }
    if (c.tool !== "text" && c.text !== "") throw new Error("Unexpected label.");
    if (c.tool === "circle" && (a[2] <= 0 || a[0] - a[2] < 0 || a[1] - a[2] < 0 ||
        a[0] + a[2] > 400 || a[1] + a[2] > 400)) throw new Error("Circle is outside the canvas.");
    if (c.tool === "rectangle" && (a[2] <= 0 || a[3] <= 0 || a[0] + a[2] > 400 ||
        a[1] + a[3] > 400)) throw new Error("Rectangle is outside the canvas.");
  }
  return data;
}

export function renderSketch(container, raw) {
  const drawing = parseSketch(raw); // Validate the entire drawing before touching the DOM.
  const doc = container.ownerDocument;
  const svgNode = (name, attrs = {}) => {
    const node = doc.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const svg = svgNode("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 400 400",
    width: 400, height: 400, role: "img", "aria-label": drawing.title || "Generated sketch" });
  const title = svgNode("title"); title.textContent = drawing.title; svg.append(title);
  svg.append(svgNode("rect", { width: 400, height: 400, fill: "white" }));
  const group = svgNode("g", { fill: "none", stroke: "#202020", "stroke-width": 2.5,
    "stroke-linecap": "round", "stroke-linejoin": "round" });
  svg.append(group);
  for (const { tool, args: a, text } of drawing.commands) {
    let node;
    if (tool === "line") node = svgNode("line", { x1: a[0], y1: a[1], x2: a[2], y2: a[3] });
    if (tool === "circle") node = svgNode("circle", { cx: a[0], cy: a[1], r: a[2] });
    if (tool === "rectangle") node = svgNode("rect", { x: a[0], y: a[1], width: a[2], height: a[3] });
    if (tool === "path") node = svgNode("path", { d: `M ${a[0]} ${a[1]} Q ${a.slice(2).join(" ")}` });
    if (tool === "text") {
      node = svgNode("text", { x: a[0], y: a[1], fill: "#202020", stroke: "none",
        "font-size": 16, "font-family": "sans-serif" });
      node.textContent = text;
    }
    group.append(node);
  }
  const caption = doc.createElement("p"); caption.textContent = drawing.title;
  const download = doc.createElement("button"); download.type = "button"; download.textContent = "Download SVG";
  download.addEventListener("click", () => {
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a"); link.href = url; link.download = "sketch.svg";
    doc.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  container.replaceChildren(svg, caption, download);
  container.classList.add("rich", "sketch");
}

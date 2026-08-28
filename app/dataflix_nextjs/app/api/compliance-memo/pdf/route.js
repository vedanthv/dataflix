import { renderMemoPdf } from "../../../../lib/memoPdf";

export const runtime = "nodejs";

// Takes the already-generated memo JSON (from /api/compliance-memo) and
// returns a real one-page PDF -- see lib/memoPdf.js for why this doesn't
// re-run the generation pipeline.
export async function POST(request) {
  try {
    const memo = await request.json();
    if (!memo?.titleName || typeof memo.titleName !== "string") {
      return Response.json({ error: "A generated memo (with titleName) is required" }, { status: 400 });
    }

    const pdfBuffer = await renderMemoPdf(memo);
    const safeName = memo.titleName.replace(/[^a-zA-Z0-9_-]+/g, "_");

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="compliance-memo-${safeName}.pdf"`,
      },
    });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface LoadInput { contractId: string; token: string }

export const loadBlockContract = createServerFn({ method: "POST" })
  .inputValidator((input: LoadInput) => {
    if (!input?.contractId || !input?.token) throw new Error("Missing contract id or token");
    return input;
  })
  .handler(async ({ data }) => {
    const { contractId, token } = data;

    const { data: signer } = await supabaseAdmin
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contractId)
      .eq("public_token", token)
      .maybeSingle();
    if (!signer) throw new Error("Invalid or expired signing link");
    if (signer.public_token_expires_at && new Date(signer.public_token_expires_at) < new Date()) {
      throw new Error("This signing link has expired");
    }

    const { data: contract } = await supabaseAdmin
      .from("contracts")
      .select("id, title, status, is_block_based, client_id")
      .eq("id", contractId)
      .maybeSingle();
    if (!contract) throw new Error("Contract not found");

    const { data: blocks } = await supabaseAdmin
      .from("contract_blocks")
      .select("*")
      .eq("contract_id", contractId)
      .order("position");

    const { data: signers } = await supabaseAdmin
      .from("contract_signers")
      .select("id, signer_role, name, signed_at")
      .eq("contract_id", contractId);

    const { data: responses } = await supabaseAdmin
      .from("contract_block_responses")
      .select("*")
      .in("contract_block_id", (blocks ?? []).map((b) => b.id));

    return { contract, blocks: blocks ?? [], signer, signers: signers ?? [], responses: responses ?? [] };
  });

interface SubmitInput {
  contractId: string;
  token: string;
  responses: { contract_block_id: string; response_text?: string | null; response_data?: any }[];
}

export const submitBlockSigning = createServerFn({ method: "POST" })
  .inputValidator((input: SubmitInput) => {
    if (!input?.contractId || !input?.token) throw new Error("Missing contract id or token");
    return input;
  })
  .handler(async ({ data }) => {
    const { contractId, token, responses } = data;

    const { data: signer } = await supabaseAdmin
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contractId)
      .eq("public_token", token)
      .maybeSingle();
    if (!signer) throw new Error("Invalid signing link");
    if (signer.signed_at) throw new Error("Already signed");

    // Upsert responses (one per (block, signer_role))
    if (responses?.length) {
      // Delete existing for this signer first
      const blockIds = responses.map((r) => r.contract_block_id);
      await supabaseAdmin
        .from("contract_block_responses")
        .delete()
        .in("contract_block_id", blockIds)
        .eq("signer_role", signer.signer_role);

      const rows = responses.map((r) => ({
        contract_block_id: r.contract_block_id,
        signer_role: signer.signer_role,
        response_text: r.response_text ?? null,
        response_data: r.response_data ?? {},
      }));
      const { error } = await supabaseAdmin.from("contract_block_responses").insert(rows);
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin
      .from("contract_signers")
      .update({ signed_at: new Date().toISOString() })
      .eq("id", signer.id);

    // If all signers have signed, mark contract signed.
    const { data: allSigners } = await supabaseAdmin
      .from("contract_signers")
      .select("signed_at")
      .eq("contract_id", contractId);
    const allSigned = (allSigners ?? []).every((s) => !!s.signed_at);
    if (allSigned) {
      await supabaseAdmin
        .from("contracts")
        .update({ status: "signed", signed_at: new Date().toISOString() })
        .eq("id", contractId);
    }

    return { ok: true, all_signed: allSigned };
  });

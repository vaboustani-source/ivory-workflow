import { useState } from "react";
import { fmtCents } from "@/lib/invoiceMath";
import { FinalizationModal } from "./FinalizationModal";
import { CancellationModal } from "./CancellationModal";

interface Props {
  clientId: string;
  coupleLabel: string;
  weddingDateISO: string | null;
  depositCents: number;
  finalizeByISO: string | null;
  currentPackageId: string | null;
  onChanged: () => void;
}

export function TbdBanner({ clientId, coupleLabel, weddingDateISO, depositCents, finalizeByISO, currentPackageId, onChanged }: Props) {
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const finalizeBy = finalizeByISO ? new Date(finalizeByISO + "T00:00:00") : null;
  const overdue = finalizeBy ? finalizeBy.getTime() < today.getTime() : false;
  const daysOverdue = finalizeBy ? Math.floor((today.getTime() - finalizeBy.getTime()) / 86400000) : 0;

  return (
    <>
      <div
        className="rounded-sm px-6 py-5 mb-6 flex items-start justify-between gap-4"
        style={{
          background: overdue ? "#E592AC" : "var(--sbv-pink, #F0A5BE)",
          borderLeft: overdue ? "4px solid var(--sbv-green)" : undefined,
          boxShadow: overdue ? undefined : "inset 4px 0 0 0 transparent",
        }}
      >
        {!overdue && <div className="absolute" style={{ width: 4 }} />}
        <div className={overdue ? "" : "border-l-4 pl-4 -ml-4"}
             style={!overdue ? { borderImage: "linear-gradient(180deg, #E8C547, #C9A227, #AE8C29) 1", borderImageSlice: 1 } : {}}>
          <h3 className="font-serif text-xl" style={{ color: overdue ? "var(--sbv-green)" : "var(--sbv-green)" }}>
            {overdue ? "OVERDUE — Package finalization required" : "Date hold — package not yet finalized"}
          </h3>
          <p className="text-sm mt-1" style={{ color: "var(--sbv-purple)" }}>
            Deposit of <span className="font-medium">{fmtCents(depositCents)}</span> collected.
            {finalizeBy && (
              <> Finalize package by <span className="font-medium">{finalizeBy.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span> to generate the full payment schedule.</>
            )}
            {overdue && <span className="block mt-1 italic">This date hold is {daysOverdue} day{daysOverdue === 1 ? "" : "s"} overdue. Finalize or cancel to clear.</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => setCancelOpen(true)} className="text-sm" style={{ color: "var(--sbv-purple)" }}>
            Cancel booking
          </button>
          <button onClick={() => setFinalizeOpen(true)}
            className="px-4 py-2 rounded-sm text-sm font-medium text-white"
            style={{ background: "var(--sbv-green)" }}>
            Finalize package now
          </button>
        </div>
      </div>

      <FinalizationModal
        open={finalizeOpen} clientId={clientId} coupleLabel={coupleLabel}
        weddingDateISO={weddingDateISO} depositCents={depositCents}
        currentPackageId={currentPackageId}
        onClose={() => setFinalizeOpen(false)} onFinalized={onChanged}
      />
      <CancellationModal
        open={cancelOpen} clientId={clientId} depositCents={depositCents}
        onClose={() => setCancelOpen(false)} onCancelled={onChanged}
      />
    </>
  );
}

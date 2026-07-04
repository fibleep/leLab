import React from "react";
import { Construction } from "lucide-react";
import TopNav from "@/components/nav/TopNav";
import Footer from "@/components/Footer";
import { Panel, Kicker } from "@/components/brand/primitives";

const EditDataset = () => {
  return (
    <div className="min-h-[100dvh] bg-surface text-ink">
      <TopNav />

      <main className="mx-auto max-w-[1400px] px-6 pb-16 pt-28 md:px-8">
        <Kicker>Datasets</Kicker>
        <h1 className="mt-3 font-mono text-2xl font-bold uppercase tracking-tight text-ink md:text-3xl">
          Edit Dataset
        </h1>

        <Panel className="mt-8">
          <div className="flex flex-col items-center gap-3 rounded-panel border border-dashed border-line bg-subtle px-6 py-16 text-center">
            <Construction className="h-8 w-8 text-ink-3" />
            <div className="font-sans text-sm text-ink">
              This page is under construction.
            </div>
            <div className="max-w-sm font-sans text-[13px] italic text-ink-3">
              Dataset editing is not available yet. Record or upload episodes
              from the dashboard in the meantime.
            </div>
          </div>
        </Panel>
      </main>

      <Footer />
    </div>
  );
};

export default EditDataset;

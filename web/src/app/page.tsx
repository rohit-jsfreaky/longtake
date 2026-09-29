import { Hero } from "@/components/Hero";
import { SiteFooter } from "@/components/SiteFooter";
import { SmoothScroll } from "@/components/motion";
import { Closing } from "@/components/sections/Closing";
import { Faq } from "@/components/sections/Faq";
import { GetExtension } from "@/components/sections/GetExtension";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { LogoRow } from "@/components/sections/LogoRow";
import { Problem } from "@/components/sections/Problem";
import { Receipt } from "@/components/sections/Receipt";
import { Steps } from "@/components/sections/Steps";
import { Stage } from "@/components/stage/Stage";

/**
 * Order matters here: problem → sequence → capability → proof → objections →
 * close. The demo sits in the middle, right after the reader has been told what
 * it does and before they are asked to trust it.
 */
export default function Home() {
  return (
    <>
      <SmoothScroll />
      <main className="flex flex-1 flex-col">
        <Hero />
        <LogoRow />
        <Problem />
        <Steps />
        <HowItWorks />
        <Stage />
        <GetExtension />
        <Receipt />
        <Faq />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}

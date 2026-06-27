import CloudScene from "@/app/components/CloudScene";

export default function Page() {
  return (
    <div className="relative w-full h-screen overflow-hidden">
      <div className="bg-[radial-gradient(65.91%_95.51%_at_104.27%_-15.49%,#fdf5db8c,#e4f9ff00),linear-gradient(174.37deg,#3D99D0_4.78%,#90C5E4_68.31%,#E4F1F9_120.96%)] dark:bg-[linear-gradient(180deg,#020B1E_0%,#00102A_25%,#022765_50%,#378DCC_75%,#DBB1B2_100%)] absolute inset-0 z-0" />
      <CloudScene />
    </div>
  );
}

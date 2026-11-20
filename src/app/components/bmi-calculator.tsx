"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Calculator, ChevronDown, Lightbulb } from "lucide-react";

type BMIResult = {
  bmi: number;
  category: string;
  color: string;
  tip: string;
  idealWeight: string;
};

export default function BMICalculator() {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState<BMIResult | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const revealCalculator = () => {
      if (window.location.hash === "#bmi" && detailsRef.current) detailsRef.current.open = true;
    };
    // Clicking the current hash does not fire hashchange. Reopen the calculator
    // when its navigation link is used again after the visitor collapses it.
    const onCalculatorLinkClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href="#bmi"]') && detailsRef.current) {
        detailsRef.current.open = true;
      }
    };
    revealCalculator();
    window.addEventListener("hashchange", revealCalculator);
    document.addEventListener("click", onCalculatorLinkClick);
    return () => {
      window.removeEventListener("hashchange", revealCalculator);
      document.removeEventListener("click", onCalculatorLinkClick);
    };
  }, []);

  useEffect(() => {
    if (result && window.innerWidth < 1024) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultRef.current?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
    }
  }, [result]);

  function calculateBMI(event: React.FormEvent) {
    event.preventDefault();
    const h = Number(height) / 100;
    const w = Number(weight);
    if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return;
    const bmi = Math.round((w / (h * h)) * 10) / 10;

    let category: string;
    let color: string;
    let tip: string;
    // Match every category to the rounded number displayed, including 25 and 30.
    if (bmi < 18.5) {
      category = "Underweight";
      color = "text-blue-400";
      tip = "You may benefit from strength training and a calorie-rich diet. Our trainers can build a mass-gain plan for you.";
    } else if (bmi < 25) {
      category = "Healthy Weight";
      color = "text-green-400";
      tip = "Great job! Maintain your fitness with balanced workouts and nutrition. Join us to build strength & endurance.";
    } else if (bmi < 30) {
      category = "Overweight";
      color = "text-yellow-400";
      tip = "A mix of cardio & strength training can help. Our trainers can design a weight loss program tailored to you.";
    } else {
      category = "Obese";
      color = "text-red-400";
      tip = "It's a great time to start your fitness journey. Our expert coaches will guide you safely to a healthier lifestyle.";
    }
    setResult({
      bmi, category, color, tip,
      idealWeight: (18.5 * h * h).toFixed(1) + "–" + (24.9 * h * h).toFixed(1) + " kg",
    });
  }

  function reset() {
    setHeight("");
    setWeight("");
    setResult(null);
    heightRef.current?.focus();
  }

  return (
    <section id="bmi" className="public-bmi py-8 md:py-12 px-4 md:px-6 border-b border-zinc-800">
      <details ref={detailsRef} className="group max-w-6xl mx-auto rounded-2xl border border-zinc-700 bg-zinc-900/40">
        <summary className="cursor-pointer flex items-center gap-4 p-5 md:p-8 rounded-2xl hover:bg-zinc-900 transition-colors">
          <Calculator size={28} className="text-yellow-500 shrink-0 hidden sm:block" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-white">
              Calculate Your <span className="text-yellow-500">BMI</span>
            </h2>
            <p className="text-sm md:text-base text-zinc-400 mt-2">Check your weight range for your height.</p>
          </div>
          <ChevronDown size={24} aria-hidden="true" className="text-yellow-500 shrink-0 transition-transform group-open:rotate-180" />
        </summary>

        <div className="p-5 pt-0 md:p-8 md:pt-0">
          <p id="bmi-guidance" className="text-sm text-zinc-400 mb-6">For adults aged 18 and over. Enter your height and weight to calculate your Body Mass Index.</p>
          <div className={result ? "grid lg:grid-cols-2 gap-6" : "max-w-xl mx-auto"}>
            <form onSubmit={calculateBMI} aria-describedby="bmi-guidance" className="space-y-5">
              <h3 className="text-xl font-bold text-white">Enter Your Details</h3>
              <div>
                <label htmlFor="bmi-height" className="block text-sm font-medium mb-2 text-zinc-200">Height (cm)</label>
                <input ref={heightRef} id="bmi-height" name="height" type="number" inputMode="decimal" autoComplete="off" value={height} onChange={(event) => { setHeight(event.target.value); setResult(null); }} placeholder="e.g. 175…" min="50" max="250" step="0.1" required className="w-full min-h-12 bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-3 text-white" />
              </div>
              <div>
                <label htmlFor="bmi-weight" className="block text-sm font-medium mb-2 text-zinc-200">Weight (kg)</label>
                <input id="bmi-weight" name="weight" type="number" inputMode="decimal" autoComplete="off" value={weight} onChange={(event) => { setWeight(event.target.value); setResult(null); }} placeholder="e.g. 70…" min="20" max="300" step="0.1" required className="w-full min-h-12 bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-3 text-white" />
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button type="submit" className="min-h-12 flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-black px-4 py-3 rounded-lg transition-colors uppercase tracking-wide text-sm">Calculate BMI</button>
                {result ? <button type="button" onClick={reset} className="min-h-12 px-5 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-lg transition-colors text-sm">Reset</button> : null}
              </div>
            </form>

            <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {result ? "Your BMI is " + result.bmi + ". " + result.category + "." : ""}
            </p>

            {result ? (
              <div ref={resultRef} className="border border-zinc-700 rounded-xl p-5 md:p-6 scroll-mt-4">
                <h3 className="text-xl font-bold text-white">Your Result</h3>
                <div className="py-6">
                  <p className={"text-6xl font-black tabular-nums " + result.color}>{result.bmi}</p>
                  <p className={"text-lg font-bold mt-2 " + result.color}>{result.category}</p>
                </div>
                <div className="border-t border-zinc-700 pt-4">
                  <p className="text-sm text-zinc-400">Weight range at BMI 18.5–24.9</p>
                  <p className="text-lg font-bold text-white mt-1">{result.idealWeight}</p>
                </div>
                <p className="flex items-start gap-2 text-sm text-zinc-300 leading-relaxed my-5">
                  <Lightbulb size={18} aria-hidden="true" className="text-yellow-500 shrink-0 mt-0.5" />
                  {result.tip}
                </p>
                <Link href="/join" className="min-h-12 flex items-center justify-center text-center bg-yellow-500 hover:bg-yellow-400 text-black font-black px-4 py-3 rounded-lg transition-colors uppercase tracking-wide text-sm">Start Your Fitness Journey</Link>
              </div>
            ) : null}
          </div>
          <p className="text-sm text-zinc-400 max-w-3xl mt-6 leading-relaxed">
            BMI is a general indicator and does not account for muscle mass, bone density, or body composition. Consult a professional trainer for a personalized fitness plan.
          </p>
        </div>
      </details>
    </section>
  );
}

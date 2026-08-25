"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Calculator, Activity } from "lucide-react";

export default function BMICalculator() {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [result, setResult] = useState<{
    bmi: number;
    category: string;
    color: string;
    tip: string;
    idealWeight: string;
  } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  function calculateBMI(e: React.FormEvent) {
    e.preventDefault();

    const h = parseFloat(height) / 100; // cm → meters
    const w = parseFloat(weight);
    const a = parseInt(age);

    if (!h || !w || h <= 0 || w <= 0) {
      return;
    }

    const bmi = w / (h * h);
    const rounded = Math.round(bmi * 10) / 10;

    let category = "";
    let color = "";
    let tip = "";

    // Categorize on the rounded value so the label always matches the number
    // shown to the user (e.g. 18.45 displays as 18.5 → "Healthy", not "Underweight").
    if (rounded < 18.5) {
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

    // Ideal weight range for the given height
    const minIdeal = (18.5 * h * h).toFixed(1);
    const maxIdeal = (24.9 * h * h).toFixed(1);

    setResult({
      bmi: rounded,
      category,
      color,
      tip,
      idealWeight: `${minIdeal} kg - ${maxIdeal} kg`,
    });

    // On phones/tablets the result panel stacks BELOW the form, so it's
    // off-screen right after submit. Bring it into view so the user actually
    // sees their BMI. On desktop (lg+) the panel already sits beside the form,
    // so scrolling would be jarring — leave it be.
    requestAnimationFrame(() => {
      if (window.innerWidth < 1024) {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function reset() {
    setHeight("");
    setWeight("");
    setAge("");
    setResult(null);
  }

  return (
    <section id="bmi" className="py-10 md:py-20 px-4 md:px-6 border-b border-zinc-800 bg-zinc-900/30">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-6 md:mb-10">
          <div className="inline-block border border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 rounded-full text-yellow-500 font-bold text-sm tracking-widest uppercase mb-4">
            Free Health Check
          </div>
          <h2 className="text-3xl md:text-4xl font-black uppercase tracking-widest text-white mb-4">
            Calculate Your <span className="text-yellow-500">BMI</span>
          </h2>
          <p className="text-zinc-400 max-w-2xl mx-auto">
            Know where you stand. Your Body Mass Index tells you if you&apos;re in a healthy weight range for your height.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Calculator Form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-yellow-500/10 rounded-lg">
                <Calculator className="text-yellow-500" size={24} />
              </div>
              <h3 className="text-2xl font-bold">Enter Your Details</h3>
            </div>

            <form onSubmit={calculateBMI} className="space-y-5">
              {/* Gender */}
              <div>
                <label className="block text-sm font-medium mb-2 text-zinc-300">
                  Gender
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setGender("male")}
                    className={`py-3 rounded-lg font-bold transition-colors ${
                      gender === "male"
                        ? "bg-yellow-500 text-black"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    Male
                  </button>
                  <button
                    type="button"
                    onClick={() => setGender("female")}
                    className={`py-3 rounded-lg font-bold transition-colors ${
                      gender === "female"
                        ? "bg-yellow-500 text-black"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    Female
                  </button>
                </div>
              </div>

              {/* Height */}
              <div>
                <label className="block text-sm font-medium mb-2 text-zinc-300">
                  Height (cm)
                </label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="e.g. 175"
                  min="50"
                  max="250"
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-500"
                />
              </div>

              {/* Weight */}
              <div>
                <label className="block text-sm font-medium mb-2 text-zinc-300">
                  Weight (kg)
                </label>
                <input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="e.g. 70"
                  min="20"
                  max="300"
                  step="0.1"
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-500"
                />
              </div>

              {/* Age */}
              <div>
                <label className="block text-sm font-medium mb-2 text-zinc-300">
                  Age (years)
                </label>
                <input
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="e.g. 25"
                  min="10"
                  max="120"
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 rounded-lg transition-colors uppercase tracking-wider"
                >
                  Calculate BMI
                </button>
                {result && (
                  <button
                    type="button"
                    onClick={reset}
                    className="px-6 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-lg"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Result Panel */}
          <div ref={resultRef} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 md:p-8 flex flex-col scroll-mt-24">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-yellow-500/10 rounded-lg">
                <Activity className="text-yellow-500" size={24} />
              </div>
              <h3 className="text-2xl font-bold">Your Result</h3>
            </div>

            {!result ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                  <Calculator className="text-zinc-600" size={40} />
                </div>
                <p className="text-zinc-500">
                  Fill in your details to see your BMI result
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center space-y-6">
                {/* BMI Score */}
                <div className="text-center py-6 bg-zinc-950 rounded-xl border border-zinc-800">
                  <p className="text-sm text-zinc-500 uppercase tracking-wider mb-2">
                    Your BMI
                  </p>
                  <p className={`text-6xl font-black ${result.color}`}>
                    {result.bmi}
                  </p>
                  <p className={`text-xl font-bold ${result.color} mt-2`}>
                    {result.category}
                  </p>
                </div>

                {/* BMI Scale */}
                <div>
                  <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wider">BMI Scale</p>
                   <div className="relative h-3 rounded-full" style={{ background: "linear-gradient(to right, #60a5fa 0%, #4ade80 33%, #facc15 66%, #ef4444 100%)",}}></div>
                  <div className="flex justify-between text-xs text-zinc-500 mt-2">
                    <span>&lt; 18.5</span>
                    <span>18.5-25</span>
                    <span>25-30</span>
                    <span>&gt; 30</span>
                  </div>
                </div>

                {/* Ideal Weight */}
                <div className="bg-zinc-950 rounded-xl border border-zinc-800 p-4">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
                    Your Ideal Weight Range
                  </p>
                  <p className="text-xl font-bold text-white">{result.idealWeight}</p>
                </div>

                {/* Tip */}
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                  <p className="text-sm text-zinc-200">
                    <span className="font-bold text-yellow-500">💡 Tip: </span>
                    {result.tip}
                  </p>
                </div>

                {/* CTA */}
                <Link
                  href="/join"
                  className="block text-center bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 rounded-lg transition-colors uppercase tracking-wider"
                >
                  Start Your Fitness Journey
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-zinc-600 text-center max-w-2xl mx-auto mt-8">
          * BMI is a general indicator and does not account for muscle mass, bone density, or body composition. 
          Consult a professional trainer for a personalized fitness plan.
        </p>
      </div>
    </section>
  );
}
import { motion } from 'motion/react';

interface SplashScreenProps {
  /** Optional label shown under the progress bar (e.g. "Carregando..."). */
  label?: string;
}

/**
 * Full-screen loading state used while the app boots / while a public
 * repertoire link is resolving. Shows the Cifras Shalom logo (static —
 * no scale/breathing) on the brand-blue background, with a diagonal
 * light sweep that shines across the "SHALOM" wordmark, then a soft
 * glow flash as the sweep exits, before settling back down.
 *
 * Timing below was reverse-engineered frame-by-frame from the reference
 * video (24fps, 960x960):
 *   - t=0.00s -> 1.50s  logo + text fully static, no motion
 *   - t=1.50s -> 2.46s  diagonal shine band sweeps left -> right across
 *                       "SHALOM" (~0.96s), peaking with a brightness/
 *                       glow flash on the word around 70-90% of the sweep
 *   - t=2.46s -> ~3.7s  static hold again before the app content takes
 *                       over (that hand-off is orchestrated by App.tsx,
 *                       not this component)
 * The sweep loops (delay before first play, repeatDelay between plays)
 * so the same cadence continues for as long as loading takes.
 */
const SWEEP_DURATION = 0.95; // seconds, matches the ~23-frame sweep window
const INITIAL_DELAY = 1.5; // seconds of static hold before the first sweep
const REPEAT_DELAY = 2.7; // seconds of static hold between sweeps (1.5s pre + 1.2s post)

export default function SplashScreen({ label }: SplashScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-brand-blue gap-6 px-6">
      <div className="relative flex flex-col items-center">
        {/* logo — static, no scale/opacity pulse (reference shows no breathing) */}
        <img
          src="/icon-192.png"
          alt="Cifras Shalom"
          className="relative w-28 h-28 drop-shadow-lg mb-3"
        />

        <span className="text-white text-xl font-bold tracking-wide leading-tight">
          CIFRAS
        </span>

        {/* wordmark that receives the shine sweep + glow flash */}
        <motion.span
          className="relative text-white text-2xl font-extrabold tracking-wide leading-tight overflow-hidden"
          animate={{
            filter: [
              'brightness(1) drop-shadow(0 0 0 rgba(255,255,255,0))',
              'brightness(1) drop-shadow(0 0 0 rgba(255,255,255,0))',
              'brightness(1.35) drop-shadow(0 0 10px rgba(255,255,255,0.85))',
              'brightness(1) drop-shadow(0 0 0 rgba(255,255,255,0))',
            ],
          }}
          transition={{
            duration: SWEEP_DURATION,
            times: [0, 0.55, 0.8, 1],
            ease: 'easeInOut',
            repeat: Infinity,
            repeatDelay: REPEAT_DELAY,
            delay: INITIAL_DELAY,
          }}
        >
          SHALOM
          {/* diagonal light band sweeping across the word */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-0 -left-1/2 h-full w-1/3 skew-x-[-20deg] bg-gradient-to-r from-white/0 via-white/90 to-white/0 mix-blend-overlay"
            initial={{ x: '-40%' }}
            animate={{ x: ['-40%', '-40%', '340%', '340%'] }}
            transition={{
              duration: SWEEP_DURATION,
              times: [0, 0.02, 0.9, 1],
              ease: [0.4, 0, 0.2, 1],
              repeat: Infinity,
              repeatDelay: REPEAT_DELAY,
              delay: INITIAL_DELAY,
            }}
          />
        </motion.span>
      </div>

      <div className="w-48 h-1.5 rounded-full bg-white/20 overflow-hidden">
        <motion.div
          className="h-full w-1/3 rounded-full bg-white"
          animate={{ x: ['-100%', '250%'] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {label && (
        <span className="text-white/80 text-sm font-medium tracking-wide">
          {label}
        </span>
      )}
    </div>
  );
}

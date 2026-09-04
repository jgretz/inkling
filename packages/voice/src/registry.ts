import {bannedOpeners} from './detectors/banned-openers.ts';
import {bannedWords} from './detectors/banned-words.ts';
import {boldTermColon} from './detectors/bold-term-colon.ts';
import {curlyQuotes} from './detectors/curly-quotes.ts';
import {emDash} from './detectors/em-dash.ts';
import {enDashParenthetical} from './detectors/en-dash-parenthetical.ts';
import {negativeParallelism} from './detectors/negative-parallelism.ts';
import {noXNoYJustZ} from './detectors/no-x-no-y-just-z.ts';
import {notOnlyBut} from './detectors/not-only-but.ts';
import {ruleOfThree} from './detectors/rule-of-three.ts';
import {sentenceLengthUniformity} from './detectors/sentence-length-uniformity.ts';
import {signposting} from './detectors/signposting.ts';
import {throatClearing} from './detectors/throat-clearing.ts';
import {titleCaseHeading} from './detectors/title-case-heading.ts';
import {transitionStacking} from './detectors/transition-stacking.ts';
import type {Detector} from './types.ts';

/**
 * Every detector, in the order findings are grouped when two of them land on
 * the same character. Regular-expression rules first, statistical ones last,
 * which is roughly least to most arguable.
 */
export const DETECTORS: readonly Detector[] = [
  emDash,
  enDashParenthetical,
  curlyQuotes,
  negativeParallelism,
  notOnlyBut,
  noXNoYJustZ,
  titleCaseHeading,
  boldTermColon,
  bannedWords,
  bannedOpeners,
  throatClearing,
  signposting,
  ruleOfThree,
  transitionStacking,
  sentenceLengthUniformity,
];

export const DETECTORS_BY_ID: ReadonlyMap<string, Detector> = new Map(
  DETECTORS.map(function (detector) {
    return [detector.id, detector];
  }),
);

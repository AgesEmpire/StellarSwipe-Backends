import React, { useEffect, useState } from 'react';
import './DiceAnimation.css';

interface DiceAnimationProps {
  value?: number;
  isRolling?: boolean;
}

const DiceAnimation: React.FC<DiceAnimationProps> = ({ value = 1, isRolling = false }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [announced, setAnnounced] = useState(false);

  useEffect(() => {
    if (!isRolling) {
      setDisplayValue(value);
      setAnnounced(false);
    }
  }, [value, isRolling]);

  useEffect(() => {
    if (!isRolling && !announced) {
      setAnnounced(true);
    }
  }, [isRolling, announced]);

  const getDotPositions = (num: number): number[] => {
    const positions: Record<number, number[]> = {
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8],
    };
    return positions[num] || positions[1];
  };

  return (
    <div className="dice-container" role="img" aria-label={`Dice showing ${displayValue}`}>
      <div className={`dice ${isRolling ? 'rolling' : ''}`}>
        <div className="dice-face">
          {getDotPositions(displayValue).map((pos) => (
            <div key={pos} className={`dot dot-${pos}`} />
          ))}
        </div>
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {!isRolling && announced && `Rolled ${displayValue}`}
      </div>
    </div>
  );
};

export default DiceAnimation;

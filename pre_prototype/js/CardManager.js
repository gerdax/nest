// CardManager.js
class CardManager {
    constructor(mainCard, ghostCard, passageText, passage, storyManager) {
        this.mainCard = mainCard;
        this.ghostCard = ghostCard;
        this.passageText = passageText;
        this.passage = passage;
        this.storyManager = storyManager;
        this.isDragging = false;
        this.startX = 0;
        this.boxSequenceFrame = null;
        
        this.handleStart = this.handleStart.bind(this);
        this.handleMove = this.handleMove.bind(this);
        this.handleEnd = this.handleEnd.bind(this);
    }
    
    initialize() {
        this.prepareBoxSequence();
        this.mainCard.addEventListener('mousedown', this.handleStart);
        document.addEventListener('mousemove', this.handleMove);
        document.addEventListener('mouseup', this.handleEnd);
        
        this.mainCard.addEventListener('touchstart', this.handleStart);
        document.addEventListener('touchmove', this.handleMove, { passive: false });
        document.addEventListener('touchend', this.handleEnd);
    }
    
    cleanup() {
        this.mainCard.removeEventListener('mousedown', this.handleStart);
        document.removeEventListener('mousemove', this.handleMove);
        document.removeEventListener('mouseup', this.handleEnd);
        
        this.mainCard.removeEventListener('touchstart', this.handleStart);
        document.removeEventListener('touchmove', this.handleMove);
        document.removeEventListener('touchend', this.handleEnd);
    }
    
    handleStart(e) {
        e.preventDefault();
        this.isDragging = true;
        this.startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        this.mainCard.style.transition = 'none';
    }
    
    handleMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        
        const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        let deltaX = currentX - this.startX;
        const maxDragDistance = 75;
        const fadeStartThreshold = 25;
        
        deltaX = Math.max(Math.min(deltaX, maxDragDistance), -maxDragDistance);
        const rotation = deltaX * 0.1;
        const absDeltaX = Math.abs(deltaX);
        // Calculate Y offset based on drag distance (max 20px up)
        const deltaY = -20 * (absDeltaX / maxDragDistance);
        const scaleFactor = 100 + Math.min(absDeltaX / 5, 10);
    
        this.mainCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg)`;
        this.mainCard.style.backgroundSize = `${scaleFactor}%`;
        this.updateBoxSequence(deltaX, maxDragDistance);
    
        const totalProgress = Math.min(absDeltaX / (maxDragDistance * 0.7), 1);
        
        // Control passage text opacity with threshold
        const passageText = document.querySelector('#passage-text');
        if (passageText) {
            if (absDeltaX > fadeStartThreshold) {
                // Calculate fade progress only after threshold
                const fadeProgress = (absDeltaX - fadeStartThreshold) / (maxDragDistance - fadeStartThreshold);
                const opacity = 1 - (fadeProgress * 0.5); // Will fade from 1 to 0.25
                passageText.style.opacity = Math.max(0.25, opacity);
            } else {
                passageText.style.opacity = 1; // Stay fully visible before threshold
            }
        }
        if (absDeltaX > 0) {
            const scale = 0.85 + ((Math.min(absDeltaX / 100, 1)) * 0.15);
            this.ghostCard.style.opacity = totalProgress * 0.7;
            this.ghostCard.style.transform = `scale(${scale})`;
    
            const choiceText = this.mainCard.querySelector('.choice-text');
            choiceText.classList.remove('left', 'right');
            
            if (deltaX < 0) {
                choiceText.textContent = this.passage.leftChoice;
                choiceText.classList.add('right');
                choiceText.style.opacity = totalProgress;
            } else {
                choiceText.textContent = this.passage.rightChoice;
                choiceText.classList.add('left');
                choiceText.style.opacity = totalProgress;
            }}
    }
    
    handleEnd(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        
        const currentX = e.type.includes('mouse') ? e.clientX : e.changedTouches[0].clientX;
        const deltaX = currentX - this.startX;
    
        if (Math.abs(deltaX) > 50) {
            const direction = deltaX > 0 ? 'right' : 'left';
            const nextCard = this.storyManager.getNextCard(this.passage, direction);
            
            if (nextCard) {
                this.transitionToChoice(nextCard, direction);
            } else {
                this.resetCard();
            }
        } else {
            this.resetCard();
        }
    }

    prepareBoxSequence() {
        if (!(this.passage instanceof BoxCard)) return;

        for (let frame = 1; frame <= 11; frame++) {
            const image = new Image();
            image.src = this.boxSequenceUrl(frame);
        }
        this.setBoxSequenceFrame(6);
    }

    updateBoxSequence(deltaX, maxDragDistance) {
        if (!(this.passage instanceof BoxCard)) return;

        const progress = Math.max(-1, Math.min(1, deltaX / maxDragDistance));
        const frame = Math.max(1, Math.min(11, 6 - Math.round(progress * 5)));
        this.setBoxSequenceFrame(frame);
    }

    setBoxSequenceFrame(frame) {
        if (!(this.passage instanceof BoxCard) || frame === this.boxSequenceFrame) return;

        this.boxSequenceFrame = frame;
        this.mainCard.style.backgroundImage = `url('${this.boxSequenceUrl(frame)}')`;
    }

    boxSequenceUrl(frame) {
        return `img/box_sequence/${String(frame).padStart(2, '0')}.png`;
    }
        
    resetCard() {
        this.mainCard.style.transition = 'transform 0.3s ease, background-size 0.3s ease, background-position 0.3s ease';
        this.mainCard.style.transform = 'none';
        this.mainCard.style.backgroundSize = '100%';
        this.mainCard.style.backgroundPosition = '50% center';
        this.mainCard.style.opacity = '1';
        this.setBoxSequenceFrame(6);
    
        this.ghostCard.style.opacity = '0';
        const choiceText = this.mainCard.querySelector('.choice-text');
        choiceText.classList.remove('left', 'right');
        choiceText.style.opacity = '0';
    
        // Reset passage text opacity
        const passageText = document.querySelector('#passage-text');
        if (passageText) {
            passageText.style.opacity = '1';
        }
    }
    
    transitionToChoice(nextCard, direction) {
        // Remove passage text immediately
        const passageText = document.querySelector('#passage-text');
        if (passageText) {
            passageText.remove();
        }

        // For box-items type, we need to transition to carousel
        if (nextCard.type === 'box-items') {
            this.mainCard.style.transition = 'all 0.3s ease';
            const multiplier = direction === 'right' ? 1 : -1;
            this.mainCard.style.transform = `translate(${multiplier * window.innerWidth}px, -${window.innerHeight * 0.3}px) rotate(${multiplier * 45}deg)`;
            this.mainCard.style.opacity = '0';

            setTimeout(() => {
                // Create and setup carousel directly
                const carousel = new BoxItemCarousel(document.getElementById('card-container'), nextCard.boxCard, this.storyManager);
                carousel.setupCarousel();
            }, 300);
            return;
        }

        if (nextCard.image) {
            this.ghostCard.style.backgroundImage = `url('${nextCard.image}')`;
        }
    
        this.mainCard.style.transition = 'all 0.3s ease';
        const multiplier = direction === 'right' ? 1 : -1;
        this.mainCard.style.transform = `translate(${multiplier * window.innerWidth}px, -${window.innerHeight * 0.3}px) rotate(${multiplier * 45}deg)`;
        this.mainCard.style.opacity = '0';
    
        this.ghostCard.style.transition = 'transform 0.4s ease, opacity 0.4s ease, background-color 0.4s ease';
        this.ghostCard.style.opacity = '1';
        this.ghostCard.style.transform = 'scale(1)';
        this.ghostCard.classList.add('transitioning');
    
        setTimeout(() => {
            window.setupCards(nextCard.id);
            // Only call logCardDetails if it's a BaseCard instance
            if (nextCard instanceof BaseCard) {
                nextCard.logCardDetails();
            }
            // Call resetBoxState if nextCard is an instance of BoxCard
            if (nextCard instanceof BoxCard) {
                nextCard.resetBoxState();
                console.log(nextCard)
            }
        }, 300);
    }}

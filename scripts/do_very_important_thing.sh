#!/bin/bash

# Funny accomplishments to randomly pick from
accomplishments=(
    "✅ Successfully mass-deleted all the code that was making you look bad"
    "✅ Optimized the codebase by mass-copy-pasting from StackOverflow"
    "✅ Replaced all tabs with spaces (or was it the other way around?)"
    "✅ Added blockchain to everything. You're welcome."
    "✅ Fixed 847 bugs by introducing 848 new ones"
    "✅ Achieved 100% code coverage by deleting all tests"
    "✅ Migrated from microservices to nano-services to pico-services"
    "✅ Converted entire codebase to use only ternary operators"
    "✅ Successfully blamed the intern for everything"
    "✅ Added machine learning. It doesn't do anything but it sounds impressive."
    "✅ Refactored refactoring to refactor the refactored refactors"
    "✅ Implemented quantum debugging (bugs exist in superposition now)"
    "✅ Compressed entire node_modules from 2GB to 1.99GB"
    "✅ Made the code 10x faster by changing the benchmark"
    "✅ Achieved web scale by adding more console.log statements"
    "✅ Synergized the paradigms for maximum disruption"
    "✅ Pivoted from software to interpretive dance (still compiles)"
    "✅ Removed all comments because code should be self-documenting"
    "✅ Added 47 layers of abstraction for a print statement"
    "✅ Successfully mass-replaced coffee breaks with more meetings"
)

# Phase 1: Spinning dial for 2 seconds
spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
end=$((SECONDS + 2))
while [ $SECONDS -lt $end ]; do
    for (( i=0; i<${#spin}; i++ )); do
        if [ $SECONDS -ge $end ]; then break; fi
        printf "\r  ${spin:$i:1} Doing god's work..."
        sleep 0.1
    done
done
echo ""

# Phase 2: Fast scrolling output (find files)
echo "🔍 Analyzing codebase..."
sleep 0.3
find / | head -100000

# Phase 3: Show funny accomplishments
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 VERY IMPORTANT TASK COMPLETED! Here's what I did:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Pick 3-5 random accomplishments
num_accomplishments=$((RANDOM % 3 + 3))
total=${#accomplishments[@]}

# Shuffle and pick
for (( i=0; i<num_accomplishments; i++ )); do
    idx=$((RANDOM % total))
    echo "${accomplishments[$idx]}"
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💪 You're welcome. That was very hard work."
echo ""

//
// A SenTree is a tableau in the familiar sentence format (without free
// variables). The SenTree constructor takes a Tree object (a free-variable
// tableau) as argument.
//
// Unlike Tree objects, SenTrees have their nodes really stored in tree form,
// with a root node and children/parent attributes.  Other than that, the nodes
// are the same Node objects as on Tree Branches.

function SenTree(fvTree, parser) {
    // turns fvTree into a textbook tableau, but does not translate back into
    // modal logic; call this.modalize() for that.
    this.nodes = [];
    this.isClosed = (fvTree.openBranches.length == 0);
    this.initFormulas = fvTree.prover.initFormulas;
    this.initFormulasNonModal = fvTree.prover.initFormulasNonModal;
    this.initFormulasNormalized = fvTree.prover.initFormulasNormalized;
    this.fvTree = fvTree;
    this.parser = parser;
    this.fvParser = fvTree.parser;
    this.constants = [];

    this.markEndNodesClosed();
    this.transferNodes();
    log(this.toString());
    this.removeUnusedNodes();
    log(this.toString());
    this.replaceFreeVariablesAndSkolemTerms();
    log(this.toString());
}

SenTree.prototype.markEndNodesClosed = function() {
    for (var i=0; i<this.fvTree.closedBranches.length; i++) {
        var branch = this.fvTree.closedBranches[i]; 
        branch.nodes[branch.nodes.length-1].closedEnd = true;
    }
}


SenTree.prototype.transferNodes = function() {
    // translates the free-variable tableau into sentence tableau and translate
    // all formulas back from negation normal form.
    //
    // If A is a formula and A' its NNF then expanding A' always results in
    // nodes that also correctly expand A, when denormalized. Remember that
    // normalization drives in all negations and converts (bi)conditionals into
    // ~,v,&. For example, |~(BvC)| = |~B|&|~C|. Expanding the NNF leads to |~B|
    // and |~C|. Expanding the original formula ~(BvC) would instead lead to ~B
    // and ~C. So we can construct the senTree by going through each node X on
    // the fvTree, identity the node Y corresponding to X's origin (the node
    // from which X is expanded), expand Y by the senTree rules and mark the
    // result as corresponding to X whenever the result's NNF is X.
    //
    // Exceptions: (1) NNFs remove double negations; so DNE steps have to be
    // reinserted. (2) Biconditionals are replaced by disjunctions of
    // conjunctions in NNF, but the classical senTree rules expand them in one
    // go, so we have to remove the conjunctive formulas.

    log("initializing sentence tableau nodes");

    this.addInitNodes();
    
    // go through all nodes on all branches, denormalize formulas and restore
    // standard order of subformula expansion:
    var branches = this.fvTree.closedBranches.concat(this.fvTree.openBranches);
    for (var b=0; b<branches.length; b++) {
        var par; // here we store the parent node of the present node
        for (var n=0; n<branches[b].nodes.length; n++) {
            var node = branches[b].nodes[n];
            if (node.isSenNode) {
                // node already on sentree
                par = node.swappedWith || node;
                continue;
            }
            // <node> not yet collected, <par> is its (already collected) parent
            log(this.toString());
            par = this.transferNode(node, par);
        }
    }
}

SenTree.prototype.transferNode = function(node, par) {
    // transfer <node> from fvTree and append it to <par> node on sentree;
    // return next par node.
    //
    // Example: <node> is expanded from ¬(A→(B→C)). In the fvTree, the source
    // node has been normalized to A∧(B∧¬C), and <node> is (B∧¬C). We need to
    // figure out that this is the second node coming from the source node, so
    // that expansions are in the right order (and later references to
    // expansions of <node> reference the correct node). We also need to epand
    // the node as ¬(B→C) rather than (B∧¬C), to undo the normalization.
    //
    // So here's what we do: we first re-apply the rule (e.g. alpha) by which
    // <node> was created to the unnormalized source formula. We then check
    // which of these results, if normalized, equals <node>.formula and
    // overwrite <node>.formula with the unnormalized matching formula.
    
    var nodeFormula = node.formula;

    // first insert double negation elimination steps:
    for (var i=0; i<node.fromNodes.length; i++) {
        if (node.fromNodes[i].formula.type == 'doublenegation') {
            this.expandDoubleNegation(node.fromNodes[i]);
            log('setting fromNode '+i+' of '+node+' to '+node.fromNodes[i].dneTo);
            node.fromNodes[i] = node.fromNodes[i].dneTo; // this also changes
                                                         // fromNodes of other
                                                         // nodes with
                                                         // same fromNodes!
        }
    }
    if (par.dneTo) par = par.dneTo;
        
    switch (node.fromRule) {
    case Prover.alpha : {
        var from = node.fromNodes[0];
        log("transferring "+node+" (alpha from "+from+")");
        var f1 = from.formula.alpha(1);
        var f2 = from.formula.alpha(2);
        log("alpha1 "+f1+" alpha2 "+f2);

        // if <from> is the result of a biconditional application, reset
        // fromNodes[0] to the biconditional (A<->B is expanded to A&B | ~A&~B):
        if (from.biconditionalExpansion) {
            node.fromNodes = from.fromNodes;
            node.expansionStep = from.expansionStep;
        }
        
        // We know that <node> comes from the alpha formula <from>; <f1> and
        // <f2> are the two formulas that could legally be derived from <from>.
        // We need to find out which of these corresponds to <node>. [I used to
        // do node.formula = (node.formula.equals(f1.normalize())) ? f1 : f2;
        // but this breaks if f2.normalize() == f1.normalize() and f2 != f1,
        // e.g. in ¬((A∧¬A)∧¬(¬A∨¬¬A).]
        
        if (!nodeFormula.equals(f1.normalize())) node.formula = f2;
        else if (!nodeFormula.equals(f2.normalize())) node.formula = f1;
        else {
            // node formula matches both alpha1 and alpha2: if previous node
            // also originates from <from> by the alpha rule, this one must be
            // the second.
            node.formula = (par.fromNodes[0] && par.fromNodes[0] == from) ? f2 : f1;
        }
        this.appendChild(par, node);
        // restore correct order of alpha expansions:
        if (par.fromNodes[0] && par.fromNodes[0] == from && node.formula == f1) {
            this.reverse(par, node);
            return par;
        }
        else return node;
        
        // <>A = (Ev)(wRv & Av) is expanded to wRv & Av. 
        
    }
        
    case Prover.beta: {
        var from = node.fromNodes[0];
        log("transferring "+node+" (beta from "+from+")");
        var f1 = from.formula.beta(1);
        var f2 = from.formula.beta(2);
        log("beta1 "+f1+" beta2 "+f2);
        if (!nodeFormula.equals(f1.normalize())) node.formula = f2;
        else if (!nodeFormula.equals(f2.normalize())) node.formula = f1;
        else {
            // node formula matches both beta1 and beta2: if parent node already
            // has a child, this one is the second:
            node.formula = (par.children && par.children.length) ? f2 : f1;
        }
        // if <node> is the result of a biconditional application, mark it
        // unused for removal (A<->B is expanded to A&B | ~A&~B):
        if (from.formula.operator == '↔' ||
            (from.formula.operator == '¬' && from.formula.sub.operator == '↔')) {
            node.biconditionalExpansion = true;
            node.used = false;
            // xxx TODO what if we have a tree with nodes ¬(A&B) and (A<->B)?! This
            // will be closed with the hidden biconditional expansion node!
        }
        this.appendChild(par, node);
        if (par.children.length == 2 && node.formula == f1) {
            log('swapping children because node.formula == beta1');
            par.children.reverse();
        }
        return node;
    }
        
    case Prover.gamma: case Prover.delta: case Prover.modalDelta: {
        // <node> is the result of expanding a (possibly negated)
        // quantified formula.
        var from = node.fromNodes[0];
        log("transferring "+node+" (gamma/delta from "+from+")");
        var matrix = from.formula.matrix || from.formula.sub.matrix;
        if (this.fvTree.prover.s5 && matrix.sub1 &&
            matrix.sub1.predicate == this.fvParser.R) {
            // in S5, ∀x(¬wRxvAx) and ∃x(wRx∧Ax) are expanded directly to Ax;
            // ¬∀x(¬wRxvAx) and ¬∃x(wRx∧Ax) to ¬Ax.
            log('yes');
            var newFla = from.formula.sub ? matrix.sub2.negate() : matrix.sub2;
        }
        else {
            var newFla = from.formula.sub ? matrix.negate() : matrix;
        }
        var boundVar = from.formula.sub ? from.formula.sub.variable : from.formula.variable;
        log(boundVar + ' is instantiated (in '+newFla+') by '+node.instanceTerm);
        if (node.instanceTerm) {
            node.formula = newFla.substitute(boundVar, node.instanceTerm);
        }
        else {
            node.formula = newFla;
        }
        this.appendChild(par, node);
        return node;
    }

    case Prover.modalGamma: {
        // <node> is the result of expanding a □ or ¬◇ formula.
        var from = node.fromNodes[0];
        log("transferring "+node+" (modalGamma from "+from+")");
        if (from.formula.sub) { // from = ¬◇A = ¬∃v(wRv ∧ Av)
            var newFla = from.formula.sub.matrix.sub2.negate();
            var boundVar = from.formula.sub.variable;
        }
        else { // from = □A = ∀v(wRv → Av)
            var newFla = from.formula.matrix.sub2;
            var boundVar = from.formula.variable;
        }
        log(boundVar + ' is instantiated (in '+newFla+') by '+node.instanceTerm);
        node.formula = newFla.substitute(boundVar, node.instanceTerm);
        this.appendChild(par, node);
        return node;
    }

    default: {
        this.appendChild(par, node);
        return node;
    }
    }
}

SenTree.prototype.addInitNodes = function() {
    // add initNodes to tree with their original, but demodalized formula
    var branch = this.fvTree.closedBranches.length > 0 ?
        this.fvTree.closedBranches[0] : this.fvTree.openBranches[0];
    
    for (var i=0; i<this.initFormulasNonModal.length; i++) {
        log('adding init node '+branch.nodes[i]);
        var node = this.makeNode(branch.nodes[i]);
        node.formula = this.initFormulasNonModal[i]; // yes, we overwrite the node's original
                                                     // (normalized) formula -- don't need
                                                     // it anymore.
        if (i==0) this.nodes.push(node);
        else this.appendChild(this.nodes[i-1], node);
    }
}

SenTree.prototype.expandDoubleNegation = function(node) {
    // expand doublenegation node <node> on current tree
    if (node.dneTo) return;
    log("expanding double negation "+node);
    var newNode = new Node(node.formula.sub.sub, null, [node]);
    this.makeNode(newNode);
    node.dneTo = newNode;
    // if <node> is first result of alpha expansion, dne node must be inserted
    // after second result:
    var dnePar = node;
    if (node.children[0] && node.children[0].fromNodes[0] == node.fromNodes[0]) {
        dnePar = node.children[0];
    }
    newNode.parent = dnePar;
    newNode.children = dnePar.children;
    dnePar.children = [newNode];
    for (var i=0; i<newNode.children.length; i++) {
        newNode.children[i].parent = newNode;
    }
    newNode.used = node.used;
    this.nodes.push(newNode);
} 

SenTree.prototype.replaceFreeVariablesAndSkolemTerms = function() {
    log("replacing free variables and skolem terms by new constants");
    // Free variables and skolem terms are replaced by ordinary constant. We
    // want these to appear in a sensible order, so we have to go node by node.
    // We also need to make sure we don't include terms only occurring on
    // removed nodes.
    //
    // Free variables all begin with 'ζ' (worlds) or 'ξ' (individuals).  Skolem
    // terms all look like 'φ1', 'φ1(𝛏1,𝛏2..)' (for individuals) or 'ω1'
    // etc. (for worlds); after unification they can also be nested:
    // '𝛗1(𝛏1,𝛗2(𝛏1)..)'. Note that a skolem term can occur inside an ordinary
    // function term. xxx Need to check if this should be accounted for;
    // substitution is shallow...
    
    var translations = {};
    for (var n=0; n<this.nodes.length; n++) {
        var node = this.nodes[n];
        var varMatches = node.formula.string.match(/[ξζ]\d+/g);
        if (varMatches) {
            for (var j=0; j<varMatches.length; j++) {
                var fv = varMatches[j];
                if (!translations[fv]) {
                    var sym = (fv[0] == 'ζ') ?
                        this.parser.getNewWorldName() : this.parser.getNewConstant();
                    translations[fv] = sym;
                }
                log("replacing "+fv+" by "+translations[fv]);
                node.formula = node.formula.substitute(
                    fv, translations[fv]
                );
            }
        }
        var skterms = getSkolemTerms(node.formula);
        var indivTerms = skterms[0], worldTerms = skterms[1];
        for (var c=0; c<indivTerms.length; c++) {
            var termstr = indivTerms[c].toString();
            if (!translations[termstr]) {
                log(termstr + " is skolem term");
                translations[termstr] = this.parser.getNewConstant();
            }
            node.formula = node.formula.substitute(
                indivTerms[c], translations[termstr], true
            );
        }
        for (var c=0; c<worldTerms.length; c++) {
            var termstr = worldTerms[c].toString();
            if (!translations[termstr]) {
                log(termstr + " is worldly skolem term");
                translations[termstr] = this.parser.getNewWorldName(true);
            }
            node.formula = node.formula.substitute(
                worldTerms[c], translations[termstr], true
            );
        }
    }
    
    function getSkolemTerms(formula) {
        // skolem terms for worlds begin with 'ω'. xxx this does not look for
        // skolem terms inside other terms!
        var worldTerms = [];
        var indivTerms = [];
        var flas = [formula];
        var fla;
        while ((fla = flas.shift())) {
            if (fla.sub) {
                flas.unshift(fla.sub);
            }
            else if (fla.sub1) {
                flas.unshift(fla.sub1);
                flas.unshift(fla.sub2);
            }
            else if (fla.matrix) {
                flas.unshift(fla.matrix);
            }
            else {
                for (var i=0; i<fla.terms.length; i++) {
                    if (fla.terms[i].isArray) {
                        if (fla.terms[i][0][0] == 'φ') indivTerms.push(fla.terms[i]);
                        else if (fla.terms[i][0][0] == 'ω') worldTerms.push(fla.terms[i]);
                    }
                    else {
                        if (fla.terms[i][0] == 'φ') indivTerms.push(fla.terms[i]);
                        else if (fla.terms[i][0] == 'ω') worldTerms.push(fla.terms[i]);
                    }
                }
            }
        }
        return [indivTerms, worldTerms];
    }
}

SenTree.prototype.getNewConstant = function() {
    // We want to reuse constants that have been used by the clauses in
    // modelfinder, so we don't call this.parser.getNewConstant(). xxx update, and del this.constants
    var candidates = 'abcdefghijklmno';
    for (var i=0; i<candidates.length; i++) {
        var sym = candidates[i];
        if (this.constants.includes(sym)) continue;
        if (this.parser.expressionType[sym]) {
            if (this.parser.expressionType[sym]  != 'individual constant') {
                continue;
            }
        }
        else {
            this.parser.registerExpression(sym, 'individual constant', 0);
        }
        this.constants.push(sym);
        return sym;
        // after we've gone through <candidates>, add indices to first element:
        candidates.push(candidates[0]+(i+2));
    }
}

SenTree.prototype.removeUnusedNodes = function() {
    log("removing unused nodes");
    if (!this.isClosed) return;
    // first, mark all nodes that were added along with used nodes as used:
    for (var i=0; i<this.nodes.length; i++) {
        var node = this.nodes[i];
        if (node.used) {
            var expansion = this.getExpansion(node);
            for (var j=0; j<expansion.length; j++) {
                if (!expansion[j].biconditionalExpansion) {
                    expansion[j].used = true;
                }
            }
        }
    }
    // now remove all unused nodes:
    for (var i=0; i<this.nodes.length; i++) {
        if (!this.nodes[i].used) {
            var ok = this.remove(this.nodes[i]);
            if (ok) i--; // reducing i because remove() removed it from the array
        }
    }
}



SenTree.prototype.modalize = function() {
    // undo standard translation for formulas on the tree, and hide some nodes
    // to make tree look like a familiar modal tree.
    //
    // Example: ◇(p→q) is translated into ∃v(wRv ∧ (pv → qv)), and expanded into
    // (wRu ∧ (pu → qu)). This is further expanded to wRu and (pu → qu). We want
    // to hide the direct result of first expansion and translate (pu → qu) back
    // into (p → q) with world label u.
    //
    // Example: □p is translated into ∀v(wRv → pv), expanded by modalGamma to pu.

    // xxx update 

    log("modalizing tree");
    var removeNodes = [];
    for (var i=0; i<this.nodes.length; i++) {
        
        var node = this.nodes[i];
        var formula = node.formula;
        log('modalising '+formula);

        // catch modal expansions: ◇A => (Rxy∧A), ¬□A => ¬(Rxy→A), □A =>
        // (Rxy→A), ¬◇A => ¬(Rxy∧A). xxx update comment
        if ((formula.sub1 && formula.sub1.predicate == this.fvParser.R) ||
            (formula.sub && formula.sub.sub1 && formula.sub.sub1.predicate == this.fvParser.R)) {
            log('marking modal expansion '+formula.string+' for removal');
            // removeNodes.push(node);
        }
        
        if (removeNodes.includes(node.fromNodes[0])) {
            // remove leaf nodes expanded from (Rxy→A) or ¬(Rxy∧A):
            // if (formula.sub && formula.sub.predicate == this.parser.R) {
            //     log('marking leaf node '+formula+' for removal');
            //     removeNodes.push(node);
            //     continue;
            // }
            // adjust fromNodes of surviving nodes descending from modal
            // expansions:
            var modalExpansion = node.fromNodes[0];
            if (modalExpansion.fromNodes[0].formula.type == 'diamondy') {
                // ◇A => Rxy,A come from ◇A; ¬□A => Rxy,¬A come from ¬□A
                node.fromNodes = modalExpansion.fromNodes;
                // xxx could node.fromNodes have more than 1 member here?
            }
            else { // 'boxy' origin
                // □A => [removed ¬Rxy],A come from □A AND Rxy node; ¬◇A => [removed
                // ¬Rxy],A come from ¬◇A AND Rxy node
                // node.fromNodes = [modalExpansion.fromNodes[0]];
                // // find Rxy node: first, get 'Rxy' string from removed sibling:
                // var sibf = node.parent.children[0].formula.sub;
                // var rxy = sibf.terms[0] + sibf.predicate + sibf.terms[1];
                // log('rxy = '+rxy);
                // for (var anc=node.parent; anc; anc=anc.parent) {
                //     if (anc.formula.string == rxy) {
                //         node.fromNodes.push(anc);
                //         log('match: '+anc);
                //         break;
                //     }
                // }
            }
            log('adjusting fromNodes of '+formula+' to '+node.fromNodes);
        }
        
        node.formula = this.fvParser.translateToModal(formula);
        // log(formula+' => '+node.formula);
        // log('w: '+node.formula.world);
    }

    for (var i=0; i<removeNodes.length; i++) {
        this.remove(removeNodes[i]);
    }
    
    // this.relabelWorlds();
    log(this.toString());
}

SenTree.prototype.relabelWorlds = function() {
    // During proof construction, we have often used nice world names like 'v',
    // 'u', etc. e.g. in accessibility formulas or for skolemizing in cnfs etc.;
    // these symbols may also occur as overt variables for individuals. We still
    // want to use them as world names. xxx update
    if (!this.parser.isModal) return; 
    log("relabeling worlds");
    var nameMap = { 'w' : 'w' };
    for (var i=0; i<this.nodes.length; i++) {
        var node = this.nodes[i];
        if (node.formula.predicate == this.fvParser.R) {
            // relabel worlds in wRv:
            var newWorld = node.formula.terms[1];
            if (!nameMap[newWorld]) {
                nameMap[newWorld] = this.getNewWorldName();
            }
            var newTerms = node.formula.terms.map(function(w){return nameMap[w]});
            log('replacing terms in '+node.formula+' by '+newTerms);
            node.formula = new AtomicFormula(this.fvParser.R, newTerms);
            // also adjust 'Rwv' => 'wRv':
            node.formula.string = newTerms[0] + 'R' + newTerms[1];
        }
        else {
            var oldName = node.formula.world;
            node.formula.world = nameMap[oldName];
            log('replacing '+oldName+' with '+node.formula.world);
        }
    }
}

SenTree.prototype.getNewWorldName = function() {
    var candidates = 'vutsrqponmlkjihgfedcbazyx'.split('');
    if (!this.usedWorldNames) this.usedWorldNames = ['w'];
    for (var i=0; i<candidates.length; i++) {
        var sym = candidates[i];
        if (!this.usedWorldNames.includes(sym)) {
            this.usedWorldNames.push(sym);
            return sym;
        }
        // after we've gone through <candidates>, add indices to first element:
        candidates.push('w'+(i+2));
    }
}



SenTree.prototype.makeNode = function(node) {
    node.parent = null;
    node.children = [];
    node.isSenNode = true;
    return node;
}

SenTree.prototype.appendChild = function(oldNode, newNode) {
   log("appending "+newNode+" to "+ oldNode); 
   if (!newNode.isSenNode) {
       newNode = this.makeNode(newNode);
   }
   newNode.parent = oldNode;
   oldNode.children.push(newNode);
   if (oldNode.closedEnd) {
      oldNode.closedEnd = false;
      newNode.closedEnd = true;
   }
   this.nodes.push(newNode);
   return newNode;
}

SenTree.prototype.remove = function(node) {
    if (node.isRemoved) return;
    log("removing " + node + " (parent: " + node.parent + ", children: " + node.children + ")");
    if (node.parent.children.length == 1) {
        node.parent.children = node.children;
        if (node.children[0]) {
            node.children[0].parent = node.parent;
            node.children[0].instanceTerm = node.instanceTerm;
        }
        if (node.children[1]) {
            node.children[1].parent = node.parent;
            node.children[1].instanceTerm = node.instanceTerm;
        }
    }
    else {
        if (node.children.length > 1) {
            log("can't remove a node with two children that itself has a sibling");
            return false;
        }
        var i = (node == node.parent.children[0]) ? 0 : 1;
        if (node.children[0]) {
            node.parent.children[i] = node.children[0];
            node.children[0].parent = node.parent;
            node.children[0].instanceTerm = node.instanceTerm;
        }
        else node.parent.children.remove(node);
    }
    this.nodes.remove(node);
    node.isRemoved = true;
    return true;
}

SenTree.prototype.toString = function() {
   // for debugging only
   return "<table><tr><td align='center' style='font-family:monospace'>"+getTree(this.nodes[0])+"</td</tr></table>";
   function getTree(node) {
      var recursionDepth = arguments[1] || 0;
      if (++recursionDepth > 40) return "<b>...<br>[max recursion]</b>";
      var res = (node.used ? '.' : '') + node + (node.closedEnd ? "<br>x<br>" : "<br>");
      if (node.children[1]) res += "<table><tr><td align='center' valign='top' style='font-family:monospace; border-top:1px solid #999; padding:3px; border-right:1px solid #999'>" + getTree(node.children[0], recursionDepth) + "</td>\n<td align='center' valign='top' style='padding:3px; border-top:1px solid #999; font-family:monospace'>" + getTree(node.children[1], recursionDepth) + "</td>\n</tr></table>";
      else if (node.children[0]) res += getTree(node.children[0], recursionDepth);
      return res;
   }
}

SenTree.prototype.substitute = function(oldTerm, newTerm) {
    for (var i=0; i<this.nodes.length; i++) {
        log("substituting "+oldTerm+" by "+newTerm+" in "+this.nodes[i].formula);
        this.nodes[i].formula = this.nodes[i].formula.substitute(oldTerm, newTerm);
    }
}

SenTree.prototype.reverse = function(node1, node2) {
   // swaps the position of two immediate successor nodes
   node2.parent = node1.parent;
   node1.parent = node2;
   if (node2.parent.children[0] == node1) node2.parent.children[0] = node2;
   else node2.parent.children[1] = node2;
   node1.children = node2.children;
   node2.children = [node1];
   if (node1.children[0]) node1.children[0].parent = node1;
   if (node1.children[1]) node1.children[1].parent = node1;
   if (node2.closedEnd) {
      node2.closedEnd = false;
      node1.closedEnd = true;
   }
   node2.swappedWith = node1;
   node1.swappedWith = node2;
}

SenTree.prototype.getExpansion = function(node) {
    // returns all nodes that were added to the tree in the same expansion step
    // as <node>. Here we use Node.expansionStep, which is set by
    // Branch.addNode().
    
    var res = [node];

    if (!node.expansionStep) return res; // e.g. dne nodes

    // get ancestors from same rule application:
    var par = node.parent;
    while (par && par.expansionStep == node.expansionStep) {
        res.unshift(par);
        par = par.parent;
    }
    
    // get descendants from same rule application:
    var ch = node.children[0];
    while (ch && ch.expansionStep == node.expansionStep) {
        res.push(ch);
        ch = ch.children[0];
    }
    
    // get siblings from same rule application:
    if (par) {
        for (var i=0; i<par.children.length; i++) {
            var sib = par.children[i];
            while (sib && sib.expansionStep == node.expansionStep) {
                if (!res.includes(sib)) res.push(sib);
                sib = sib.children[0];
            }
        }
    }
    
    return res;
}

SenTree.prototype.getCounterModel = function() {
    // Read off a (canonical) countermodel from an open branch. At this point,
    // the tree is an ordinary, textbook (but non-modal) tableau, without free
    // variables and normalized formulas. (Modalization is best postponed, so
    // that the countermodel for a tree with a 'pw' node (modalized, 'p')
    // assigns to 'p' a set of worlds rather than a truth-value.)

    // First, find an open branch:
    var endNode = null;
    for (var i=0; i<this.nodes.length; i++) {
        if (this.nodes[i].children.length || this.nodes[i].closedEnd) continue;
        endNode = this.nodes[i];
        break;
    }
    if (!endNode) return null;
    
    log("creating counterModel from endNode " + endNode);
    var model = new Model(this.fvTree.prover.modelfinder, 0, 0);
   
    // Next we set up the domain and map every term to a number in the
    // domain. Remember that f(a) may denote an individual that is not denoted
    // by any individual constant. A standard canonical model assigns to an
    // n-ary function term f a function F such that for all (t1...tn) for which
    // f(t1...tn) occurs on the branch, F(T1...Tn) = "f(t1...tn)", where Ti is
    // the intepretation of ti (i.e. the string "ti"). For all other arguments
    // not occuring on the branch as arguments of f, the value of F is
    // arbitrary. If we find f(t1...tn) on a branch, we simply set
    // model.denotations["f(t1...tn)"] to a new element of the domain.  (Note
    // that in a complete canonical tableau, GAMMA formulas are expanded for all
    // terms on the branch. So if ∀x¬Gf(x) & Ga is on the branch, then so are
    // ¬Gf(a), ¬Gf(f(a)), etc.  All open branches on a complete canonical
    // tableaux containing functional terms are thus infinite. The current tree
    // will never be infinite, so it's always by luck if it finds a model in
    // this case.)

    var node = endNode;
    if (this.parser.isModal) {
        // make sure 'w' is assigned world 0:
        model.worlds = [0];
        model.denotations['w'] = 0;
    }
    do {
        var fla = node.formula;
        // remove double negations:
        while (fla.operator == '¬' && fla.sub.operator == '¬') {
            fla = fla.sub.sub;
        }
        var atom = (fla.operator == '¬') ? fla.sub : fla;
        if (!atom.predicate) continue; 
        var terms = atom.terms.copy();
        for (var t=0; t<terms.length; t++) {
            var term = terms[t].toString();
            if (term in model.denotations) continue;
            var domain = this.fvParser.expressionType[term] &&
                this.fvParser.expressionType[term].indexOf('world') > -1 ?
                model.worlds : model.domain;
            log("adding "+domain.length+" to domain for "+term);
            domain.push(domain.length);
            model.denotations[term] = domain.length-1;
            if (terms[t].isArray) {
                for (var i=1; i<terms[t].length; i++) terms.push(terms[t][i]);
            }
        }
        if (!model.extendToSatisfy(fla)) {
            log("!!! model doesn't satisfy "+fla);
            return null;
        }
        log(model.toString());
    } while ((node = node.parent));
    
    if (model.domain.length == 0) {
        model.domain = [0];
    }
    return model;
    
    
    node = endNode;
    do {
        var fla = node.formula;
        var tv = true;
        while (fla.operator == '¬') {
            fla = fla.sub;
            tv = !tv;
        }
        if (!fla.predicate) continue;
        log("interpreting " + node);
        if (fla.terms.length == 0) { // propositional constant
            model.values[fla.predicate] = tv;
            continue;
        }
        // interpret function symbols:
        var subTerms = fla.terms.copy();
        for (var t=0; t<subTerms.length; t++) {
            var term = subTerms[t];
            if (!term.isArray) continue;
            var functor = term[0], args = term.slice(1);
            if (!model.values[functor]) {
                // init functor interpretation; recall that model.values['f'] is
                // the list of function values, e.g. [0,1,0,0] corresponding to
                // the list of possible function arguments, e.g. [<0,0>, <0,1>,
                // <1,0>, <1,1>]. This second list is stored in
                // model.argLists[arity].
                var arity = args.length;
                if (!model.argLists[arity]) {
                    model.argLists[arity] = Model.initArguments(arity, numIndividuals);
                }
                model.values[functor] = Array.getArrayOfZeroes(model.argLists[arity].length);
            }
            // now make sure the value assigned to 'f' for the value of '(ab)'
            // is terms2individuals['f(ab)'];
            var argValues = [];
            for (var i=0; i<args.length; i++) {
                argValues.push(terms2individuals[args[i].toString()]);
            }
            var argsIndex = model.argLists[arity].indexOf(argValues.toString());
            model.values[functor][argsIndex] = terms2individuals[term.toString()]; 
        }
        // interpret predicate:
        if (!model.values[fla.predicate]) {
            var arity = fla.terms.length; // always >0 because we've dealt with the other case before
            if (!model.argLists[arity]) {
                model.argLists[arity] = Model.initArguments(arity, numIndividuals);
            }
            model.values[fla.predicate] = Array.getArrayOfZeroes(model.argLists[arity].length);
        }
        // make sure the value assigned to 'F' for the value of '(ab)' is tv:
        var argValues = [];
        for (var i=0; i<fla.terms.length; i++) {
            argValues.push(terms2individuals[fla.terms[i].toString()]);
        }
        var argsIndex = model.argLists[arity].indexOf(argValues.toString());
        model.values[fla.predicate][argsIndex] = tv;
        log(model);
    } while ((node = node.parent));
    log("model: " + model);
    if (model.satisfiesInitFormulas()) return model;
    return null;
}


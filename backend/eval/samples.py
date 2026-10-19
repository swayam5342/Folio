"""Content of the evaluation corpus: four short documents, written for Folio.

Each document is a list of pages; each page is a small HTML fragment rendered
onto exactly one PDF page by build_samples.py, so the dataset's gold page
numbers are known exactly. Headings use <h1>/<h2> (larger type) and code uses
<pre> (monospaced), which is what structure-aware chunking looks for.

The networking and operating-systems notes describe real, standard material.
The sleep study and the campus policy are fictional and say so on every page.
"""

SYNTHETIC_NOTE = "Synthetic sample document created for evaluating Folio. The institution, study and data are fictional."

DOCUMENTS: dict[str, dict] = {
    "networks-tcp-congestion.pdf": {
        "title": "CS-342 Computer Networks: Lecture 7, TCP Congestion Control",
        "footer": "CS-342 Computer Networks · Lecture 7",
        "pages": [
            """
<h1>Lecture 7: TCP Congestion Control</h1>
<h2>Flow control versus congestion control</h2>
<p>TCP limits how much unacknowledged data a sender may have in flight for two different reasons.
<b>Flow control</b> protects the receiver: the receiver advertises a receive window (rwnd) with the amount
of free buffer space it has, and the sender never exceeds it. <b>Congestion control</b> protects the
network: the sender keeps its own congestion window (cwnd), an estimate of how much the path can carry
without queues overflowing.</p>
<p>At any moment the sender may transmit up to the smaller of the two windows, so the effective window is
min(cwnd, rwnd). A fast receiver on a slow, shared path is limited by cwnd; a slow receiver on a fast path
is limited by rwnd.</p>
<h2>Why congestion control exists</h2>
<p>In October 1986 the early Internet suffered a series of congestion collapses: throughput between two
sites at Berkeley fell from 32 kbit/s to 40 bit/s, because senders kept retransmitting into full queues.
Van Jacobson's 1988 algorithms (slow start, congestion avoidance and fast retransmit) were the response,
and every TCP implementation has used a descendant of them since.</p>
<h2>Congestion signals</h2>
<p>A TCP sender cannot see router queues directly. Classic TCP infers congestion from <b>packet loss</b>,
detected either by a retransmission timeout or by duplicate acknowledgements. Newer algorithms also use
<b>delay</b> (a growing round-trip time means queues are building) and explicit marks from routers (ECN).</p>
""",
            """
<h1>Slow Start</h1>
<p>A new connection does not know the capacity of the path, so it probes for it. During <b>slow start</b>
the sender begins with a small initial window and increases cwnd by one maximum segment size (MSS) for
every acknowledgement that arrives. Because a full window of segments is acknowledged each round-trip time,
cwnd <b>doubles every RTT</b>: the growth is exponential, despite the name.</p>
<h2>Initial window</h2>
<p>Classic TCP started with an initial window of one segment. RFC 6928 (2013) raised the recommended
initial window to ten segments, which lets short web transfers finish in fewer round trips. With an MSS of
1460 bytes, an initial window of ten segments is 14,600 bytes.</p>
<h2>When slow start ends</h2>
<p>Slow start continues until one of three things happens:</p>
<ul>
<li>cwnd reaches the <b>slow start threshold</b> (ssthresh), and the sender switches to congestion avoidance;</li>
<li>a loss is detected, and the sender reacts as described in the section on loss recovery;</li>
<li>cwnd reaches the receiver's window, so the receiver becomes the limit.</li>
</ul>
<p>For a new connection ssthresh is set arbitrarily high, so the first slow start ends with the first loss.
Afterwards ssthresh remembers half of the window at which loss occurred, and later slow starts stop there.</p>
<h2>Worked example</h2>
<p>Starting from ten segments and with no loss, cwnd is 20 segments after one RTT, 40 after two and 80 after
three. On a path with a 100 ms RTT the sender reaches 80 segments (about 117 KB in flight) in 0.3 seconds.</p>
""",
            """
<h1>Congestion Avoidance and AIMD</h1>
<p>Once cwnd is at or above ssthresh the sender is near the capacity it last found, so it grows carefully.
In <b>congestion avoidance</b> cwnd increases by MSS &#215; MSS / cwnd for each acknowledgement, which adds
roughly <b>one MSS per round-trip time</b>: linear rather than exponential growth.</p>
<h2>Additive increase, multiplicative decrease</h2>
<p>When loss signals congestion, the window is cut multiplicatively, classically halved. This combination
is called <b>AIMD</b> (additive increase, multiplicative decrease). Plotted over time, cwnd forms the
familiar TCP <b>sawtooth</b>: slow linear climbs ending in sharp drops.</p>
<p>AIMD is used because of its fairness property. Chiu and Jain showed in 1989 that when several flows share
a bottleneck and all use AIMD, their windows converge towards equal shares of the capacity, whatever their
starting points. Additive increase moves flows towards the efficiency line at the same rate, while
multiplicative decrease shrinks large windows more than small ones.</p>
<h2>AIMD in pseudo-code</h2>
<pre>
on_ack():
    if cwnd &lt; ssthresh:
        cwnd = cwnd + MSS              # slow start
    else:
        cwnd = cwnd + MSS * MSS / cwnd # congestion avoidance

on_triple_duplicate_ack():
    ssthresh = max(flight_size / 2, 2 * MSS)
    cwnd = ssthresh                    # multiplicative decrease
</pre>
""",
            """
<h1>Loss Detection and Recovery</h1>
<h2>Retransmission timeout</h2>
<p>The sender keeps a smoothed RTT estimate (SRTT) and its variation (RTTVAR). RFC 6298 sets the
retransmission timeout to RTO = SRTT + max(G, 4 &#215; RTTVAR), where G is the clock granularity, with a
minimum of one second. When the timer expires the sender assumes heavy congestion: it sets
ssthresh = max(FlightSize / 2, 2 &#215; MSS), drops cwnd to one segment (the loss window) and begins slow
start again. Each further timeout for the same segment doubles the RTO (exponential backoff).</p>
<h2>Fast retransmit</h2>
<p>Waiting for a timeout wastes time. A receiver that gets an out-of-order segment immediately repeats its
last acknowledgement. When the sender sees <b>three duplicate ACKs</b> it concludes that one segment was
lost while later ones arrived, and retransmits the missing segment at once, without waiting for the RTO.</p>
<h2>Fast recovery (TCP Reno)</h2>
<p>Duplicate ACKs mean data is still flowing, so collapsing to one segment would be an overreaction. In fast
recovery the sender sets ssthresh to half the flight size and cwnd to ssthresh + 3 MSS (the three segments
known to have left the network). Every further duplicate ACK inflates cwnd by one MSS; when the ACK for new
data arrives, cwnd is deflated back to ssthresh and congestion avoidance resumes. TCP Tahoe, the earlier
variant, had no fast recovery and always restarted from one segment.</p>
""",
            """
<h1>Modern Congestion Control</h1>
<h2>CUBIC</h2>
<p>CUBIC has been the default congestion control in Linux since kernel 2.6.19 (2006). Instead of growing
one segment per RTT, it sets the window from the time t since the last loss:
W(t) = C(t &#8722; K)<sup>3</sup> + W<sub>max</sub>, where W<sub>max</sub> is the window at the last loss,
C = 0.4, and K is the time needed to climb back to W<sub>max</sub>. On loss CUBIC multiplies the window by
&#946; = 0.7 rather than halving it. Because growth depends on elapsed time and not on the number of RTTs,
flows with long round-trip times are not starved by flows with short ones.</p>
<h2>BBR</h2>
<p>BBR (Bottleneck Bandwidth and Round-trip propagation time), published by Google in 2016, does not treat
loss as its main signal. It continuously estimates the bottleneck bandwidth and the minimum RTT of the path,
paces packets at the estimated bandwidth and keeps about one bandwidth-delay product in flight. This keeps
queues short and performs well on paths with random, non-congestive loss.</p>
<h2>Explicit Congestion Notification</h2>
<p>With ECN, a router that is starting to queue marks packets with the Congestion Experienced (CE) codepoint
instead of dropping them. The receiver echoes the mark with the ECE flag and the sender, after reducing its
window, confirms with the CWR flag. The flow slows down without losing a packet.</p>
<h2>Exam note</h2>
<p>Question 3 of the CS-342 midterm covers fast recovery; question 5 asks you to sketch the sawtooth.</p>
""",
        ],
    },
    "os-virtual-memory.pdf": {
        "title": "Operating Systems: Chapter 9, Virtual Memory",
        "footer": "Operating Systems · Chapter 9",
        "pages": [
            """
<h1>Chapter 9: Virtual Memory</h1>
<h2>Paging</h2>
<p>Paging divides a process's logical address space into fixed-size <b>pages</b> and physical memory into
<b>frames</b> of the same size. Any page can be placed in any free frame, so a process does not need a
contiguous region of physical memory and there is <b>no external fragmentation</b>. The cost is
<b>internal fragmentation</b>: on average half of the last page of each process is wasted.</p>
<h2>Address translation</h2>
<p>A logical address is split into a page number p and an offset d. The page number indexes the page
table, which gives the frame number f; the physical address is f followed by the same offset. With
4 KiB pages the offset is 12 bits, because 2<sup>12</sup> = 4096. A 32-bit address with 4 KiB pages
therefore has a 20-bit page number, so a flat page table has 2<sup>20</sup> (about one million) entries.</p>
<h2>Why pages are a power of two</h2>
<p>Because the page size is a power of two, splitting an address needs no division: the hardware simply
takes the high-order bits as the page number and the low-order bits as the offset.</p>
""",
            """
<h1>Page Tables and the TLB</h1>
<h2>Page table entries</h2>
<p>Besides the frame number, each page table entry holds control bits: a <b>valid</b> bit (the page is in
memory), a <b>dirty</b> bit (the page was written and must be saved before eviction), a <b>referenced</b>
bit (set on any access, used by replacement algorithms) and <b>protection</b> bits (read, write, execute).</p>
<h2>Multi-level page tables</h2>
<p>A flat table for a 64-bit address space would be enormous, so page tables are hierarchical. x86-64 uses
four levels for 48-bit virtual addresses: each level is indexed by 9 bits of the address and the last
12 bits are the offset (4 &#215; 9 + 12 = 48). Tables for unused parts of the address space are never
allocated.</p>
<h2>Translation lookaside buffer</h2>
<p>Walking the page table on every access would multiply memory traffic. The <b>TLB</b> is a small, fast
associative cache of recent translations. With TLB hit ratio h, TLB lookup time t<sub>tlb</sub> and memory
access time t<sub>mem</sub>, the effective access time is</p>
<p>EAT = h &#215; (t<sub>tlb</sub> + t<sub>mem</sub>) + (1 &#8722; h) &#215; (t<sub>tlb</sub> + 2 &#215; t<sub>mem</sub>)</p>
<p>For example, with a 98% hit ratio, a 20 ns TLB and 100 ns memory:
EAT = 0.98 &#215; 120 + 0.02 &#215; 220 = 122 ns, only 22% slower than a single memory access.</p>
""",
            """
<h1>Demand Paging and Page Faults</h1>
<p>With <b>demand paging</b> a page is loaded only when it is first used. An access to a page whose valid
bit is clear causes a <b>page fault</b>, which the operating system handles as follows:</p>
<ol>
<li>The hardware traps to the kernel, saving the process state.</li>
<li>The kernel checks that the reference is legal; an illegal one terminates the process.</li>
<li>It finds a free frame, running the page-replacement algorithm if none is free.</li>
<li>It schedules a disk read of the page into the frame; the process waits meanwhile.</li>
<li>When the read completes it updates the page table and sets the valid bit.</li>
<li>It restarts the instruction that caused the fault.</li>
</ol>
<h2>Cost of page faults</h2>
<p>With page-fault rate p, a 200 ns memory access and an 8 ms fault service time,
EAT = (1 &#8722; p) &#215; 200 + p &#215; 8,000,000 ns. Keeping the slowdown under 10% (EAT &lt; 220 ns)
requires p &lt; 0.0000025, fewer than one fault in about 400,000 accesses. Disk is so slow that even rare
faults dominate performance.</p>
<h2>Copy-on-write</h2>
<p>After fork(), parent and child initially share all pages, marked read-only. A page is copied only when
one of them writes to it, which makes fork() followed by exec() cheap.</p>
""",
            """
<h1>Page Replacement</h1>
<p>When no frame is free, the kernel must choose a victim page. A dirty victim is written back first.</p>
<ul>
<li><b>FIFO</b> evicts the page that has been in memory longest. It is simple but can evict heavily used pages.</li>
<li><b>Optimal (OPT, Belady's MIN)</b> evicts the page that will not be used for the longest time. It needs
future knowledge, so it serves only as a benchmark.</li>
<li><b>LRU</b> evicts the page unused for the longest time, approximating OPT by looking backwards. Exact LRU
needs timestamps or a stack on every access, which is too costly in hardware.</li>
<li><b>Clock (second chance)</b> approximates LRU with the referenced bit, as below.</li>
</ul>
<h2>Belady's anomaly</h2>
<p>With FIFO, adding frames can increase the number of faults. For the reference string
1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5, FIFO causes 9 faults with three frames but 10 faults with four.
LRU and OPT are <b>stack algorithms</b> and never show the anomaly.</p>
<h2>Clock algorithm</h2>
<pre>
def clock_evict(frames, hand):
    while True:
        page = frames[hand]
        if page.referenced:
            page.referenced = False      # second chance
            hand = (hand + 1) % len(frames)
        else:
            return hand                  # victim found
</pre>
""",
            """
<h1>Thrashing and the Working Set</h1>
<p>A process <b>thrashes</b> when it spends more time paging than executing. It happens when the processes
in memory together need more frames than exist: each fault evicts a page that is needed again soon. CPU
utilisation drops, and a naive scheduler reacts by admitting more processes, which makes it worse.</p>
<h2>Working-set model</h2>
<p>The <b>working set</b> of a process is the set of pages it referenced in the most recent &#916; memory
references (the working-set window). If the sum of all working-set sizes exceeds the number of frames,
thrashing is imminent and the operating system should <b>suspend</b> a process, freeing its frames,
rather than let every process thrash. Choosing &#916; is a trade-off: too small misses the current
locality, too large spans several localities.</p>
<h2>Page-fault frequency</h2>
<p>A simpler control watches each process's page-fault rate directly. With an upper and a lower bound,
a process faulting above the upper bound is given more frames and one faulting below the lower bound
loses frames. If no frames are free when a process needs more, a process is swapped out.</p>
<h2>Summary</h2>
<p>Virtual memory lets programs be larger than physical memory and lets processes share code, at the price
of translation hardware (the TLB) and careful replacement policies.</p>
""",
        ],
    },
    "sleep-exam-study.pdf": {
        "title": "Sleep Duration, Sleep Regularity and Final Exam Performance in Undergraduates",
        "footer": SYNTHETIC_NOTE,
        "pages": [
            """
<h1>Sleep Duration, Sleep Regularity and Final Exam Performance in Undergraduates</h1>
<p><i>Synthetic sample study. The university, participants and results are fictional.</i></p>
<h2>Abstract</h2>
<p>We followed 212 undergraduates at Northfield University for the six weeks before their final exam in an
introductory chemistry course, measuring sleep with wrist-worn actigraphs. Each additional hour of mean
nightly sleep was associated with a <b>4.1 percentage-point</b> higher final exam score after controlling
for prior grade point average. Students whose bedtimes varied more scored lower, independently of how long
they slept. Sleeping the night before the exam was not associated with scores once the six-week average was
taken into account.</p>
<h2>Introduction</h2>
<p>Students commonly trade sleep for study time near exams. Laboratory studies show that sleep supports
memory consolidation, but evidence from real courses, measured objectively over weeks rather than by
self-report, is limited. We asked whether average sleep duration and sleep regularity across a whole exam
preparation period predict exam performance.</p>
""",
            """
<h1>Methods</h1>
<h2>Participants</h2>
<p>We enrolled 231 students from CHEM-101 in the autumn semester. Nineteen were excluded for wearing the
actigraph less than 80% of the time, leaving <b>212 participants</b> (118 women and 94 men; mean age 20.3
years). Participants received course credit for taking part. The protocol was approved by the institutional
review board under protocol number IRB-2023-117.</p>
<h2>Sleep measurement</h2>
<p>Participants wore an ActiTrack 3 wrist actigraph continuously for 42 days before the final exam and kept
a brief daily sleep diary, which was used to mark when the device was removed. Sleep duration was the total
sleep time per night; <b>sleep regularity</b> was the standard deviation of sleep onset time across nights.</p>
<h2>Outcome and analysis</h2>
<p>The outcome was the final exam score as a percentage, graded blind to sleep data. We used linear
regression with mean sleep duration and sleep-onset variability as predictors, controlling for prior GPA,
gender and age. Analyses were run in R 4.3.</p>
""",
            """
<h1>Results</h1>
<h2>Sleep in the sample</h2>
<p>Mean nightly sleep was <b>6.8 hours</b> (SD 0.9). Thirty-one percent of participants averaged less
than six hours a night, and sleep fell by a mean of 38 minutes in the final week before the exam.</p>
<h2>Sleep duration and scores</h2>
<p>Each additional hour of mean nightly sleep predicted a final exam score <b>4.1 points higher</b>
(95% confidence interval 2.6 to 5.6; p &lt; 0.001), controlling for prior GPA, gender and age.</p>
<p>Mean exam score by quartile of sleep duration:</p>
<ul>
<li>Shortest quartile (under 6.1 hours): 68.2%</li>
<li>Second quartile: 72.5%</li>
<li>Third quartile: 75.9%</li>
<li>Longest quartile (over 7.5 hours): 78.4%</li>
</ul>
<h2>Sleep regularity</h2>
<p>Independently of duration, each one-hour increase in the standard deviation of sleep onset predicted a
score <b>2.3 points lower</b> (95% CI 0.9 to 3.7).</p>
<h2>The night before the exam</h2>
<p>Sleep on the final night alone was not associated with scores once the six-week average was included
(p = 0.41).</p>
""",
            """
<h1>Discussion</h1>
<p>Across six weeks of objectively measured sleep, students who slept longer and on a more regular schedule
scored higher on their final exam, and the association held after accounting for prior academic
performance. The difference between the shortest and longest sleepers, about ten percentage points, is
roughly one letter grade.</p>
<h2>Regularity matters</h2>
<p>The independent effect of sleep regularity suggests that a consistent schedule matters in addition to
total sleep. Irregular bedtimes shift the body clock, which can reduce sleep quality even when the hours add
up.</p>
<h2>Cramming</h2>
<p>That a single night before the exam did not predict scores suggests that last-minute "all-nighters" do not
help, and that what matters is sleep across the whole period in which material is learned, consistent with
the role of sleep, particularly slow-wave sleep, in consolidating memories formed earlier.</p>
""",
            """
<h1>Limitations and Conclusion</h1>
<h2>Limitations</h2>
<ul>
<li>The study is observational: sleep was not assigned, so we cannot conclude that more sleep causes higher
scores. Conscientious students may both sleep more regularly and study more effectively.</li>
<li>All participants took one course at one university, so the results may not generalise.</li>
<li>Actigraphy tends to overestimate sleep compared with laboratory polysomnography.</li>
<li>Participation was voluntary, so the sample may differ from non-participants.</li>
</ul>
<h2>Conclusion</h2>
<p>Students preparing for exams should aim for at least seven hours of sleep a night on a consistent
schedule throughout the term, rather than catching up before the exam. A randomised trial of a sleep
extension intervention is the natural next step.</p>
<h2>Funding</h2>
<p>This study received no external funding.</p>
""",
        ],
    },
    "campus-library-lab-policy.pdf": {
        "title": "Northfield University Library and Computing Labs: Usage Policy 2026",
        "footer": SYNTHETIC_NOTE,
        "pages": [
            """
<h1>Library and Computing Labs Usage Policy 2026</h1>
<p><i>Synthetic sample policy for a fictional university.</i></p>
<h2>1. Scope</h2>
<p>This policy applies to all students, staff and visitors using the Northfield University libraries and
computing labs. A valid university ID card is required to borrow items and to enter the labs.</p>
<h2>2. Borrowing limits</h2>
<p>Undergraduate students may borrow up to <b>12 items</b> at a time, postgraduate students up to
<b>25 items</b> and staff up to <b>40 items</b>. Visitors with a reference pass may use materials in the
building but may not borrow.</p>
<h2>3. Loan periods</h2>
<p>Standard loans last <b>21 days</b>. Items on course reserve are <b>short loans</b> of four hours and must
be returned to the service desk. Popular items may be marked as seven-day loans. A loan may be renewed up to
three times online, unless another reader has placed a hold on the item.</p>
""",
            """
<h1>4. Fines, Lost Items and Account Blocks</h1>
<h2>4.1 Overdue fines</h2>
<p>Overdue standard loans are charged <b>0.50 per day</b>, up to a maximum of 15.00 per item. Overdue short
loans are charged <b>1.00 per hour</b>, up to a maximum of 10.00 per item, because other students are
waiting for them.</p>
<h2>4.2 Lost and damaged items</h2>
<p>An item more than 60 days overdue is treated as lost. The borrower is charged the replacement cost plus a
<b>processing fee of 10.00</b>. If the item is later returned in good condition, the replacement cost is
refunded but the processing fee is not.</p>
<h2>4.3 Account blocks</h2>
<p>Borrowing is blocked while unpaid fines exceed <b>20.00</b>. Blocked accounts may still use materials
inside the library and the computing labs.</p>
<h2>4.4 Waivers</h2>
<p>Fines may be waived for a documented medical emergency or bereavement. Students should submit form
<b>LIB-F7</b> to the service desk within 30 days of the item's return.</p>
""",
            """
<h1>5. Computing Labs</h1>
<h2>5.1 Locations and equipment</h2>
<ul>
<li><b>Lab RM-204</b>: 40 Linux workstations with NVIDIA GPUs, intended for machine learning and graphics coursework.</li>
<li><b>Lab RM-118</b>: 60 Windows workstations with the standard teaching software.</li>
<li><b>Room RM-009</b>: assistive technology room (see section 8).</li>
</ul>
<h2>5.2 Opening hours</h2>
<p>Labs are open <b>08:00 to 22:00</b> on weekdays and <b>10:00 to 18:00</b> at weekends. During the
examination period weekday hours are extended to midnight.</p>
<h2>5.3 Booking</h2>
<p>Workstations can be booked through the student portal. Each student may book at most <b>two hours per
day</b> and at most <b>three bookings per week</b>. A booking is released to other students if it is not
claimed within <b>15 minutes</b> of its start time.</p>
""",
            """
<h1>6. Acceptable Use</h1>
<h2>6.1 Prohibited activities</h2>
<p>Lab computers may not be used for cryptocurrency mining, for sharing accounts or passwords, or for
installing unlicensed software. Food is not permitted in the labs; drinks are allowed only in sealed
containers.</p>
<h2>6.2 Printing</h2>
<p>Undergraduates receive a quota of <b>300 pages</b> of black-and-white printing per semester. Colour
printing, and printing beyond the quota, is charged at 0.20 per page.</p>
<h2>6.3 Long-running GPU jobs</h2>
<p>Interactive sessions on the RM-204 GPUs are limited to four hours. Jobs expected to run longer than
<b>four hours</b> must be submitted to the <b>long-gpu</b> batch queue instead of being run interactively:</p>
<pre>
labjob submit --queue long-gpu --gpus 1 train.py
labjob status
</pre>
<p>Jobs on the long-gpu queue may run for up to 48 hours.</p>
""",
            """
<h1>7. Group Study Rooms</h1>
<p>Group study rooms seat two to eight people and can be booked up to <b>seven days</b> in advance for a
maximum of three hours at a time. Level 3 of the main library is a silent floor; group work is not
permitted there.</p>
<h1>8. Accessibility</h1>
<p>Every lab workstation has the NVDA screen reader installed. Room RM-009 provides adjustable-height desks,
screen magnifiers and a braille embosser, and can be booked by students registered with the disability
service.</p>
<h1>9. Breaches of This Policy</h1>
<p>A first breach results in a written warning. A second breach results in a <b>two-week suspension</b> of
lab access. A third breach is referred to the student conduct office.</p>
<h1>10. Contact</h1>
<p>The library help desk can be reached on extension 4420 during opening hours.</p>
""",
        ],
    },
}

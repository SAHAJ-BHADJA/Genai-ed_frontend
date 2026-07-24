import Navbar from '@/components/Navbar';
import SectionTitle from '@/components/SectionTitle';
import ApproachCard from '@/components/Cards/ApproachCard';
import StrategyCard from '@/components/Cards/StrategyCard';
import { Shield, Lightbulb, AlertTriangle } from 'lucide-react';

export default function AboutPage() {
  const approaches = [
    {
      title: 'Interactive Platform',
      description: 'Engage with AI through hands-on experiences that foster deeper understanding and practical skill development in real-world scenarios.',
    },
    {
      title: 'Incentive-Driven Learning',
      description: 'Motivate students through rewards and recognition systems that encourage consistent engagement and achievement in their learning journey.',
    },
    {
      title: 'Ethical & Data-Informed',
      description: 'Build trust through transparent AI practices while leveraging data insights to continuously improve educational outcomes and experiences.',
    },
  ];

  const strategies = [
    {
      icon: Shield,
      title: 'Define the Boundaries',
      description: 'Establish clear guidelines and parameters for AI usage in educational contexts',
      points: [
        'Set explicit policies for acceptable AI tool usage',
        'Define academic integrity standards and expectations',
        'Create clear documentation of AI capabilities and limitations',
        'Establish protocols for different learning scenarios',
      ],
    },
    {
      icon: Lightbulb,
      title: 'Guide Learning',
      description: 'Provide structured support to enhance the educational experience',
      points: [
        'Offer contextual assistance tailored to individual learning needs',
        'Provide real-time feedback and suggestions for improvement',
        'Create personalized learning paths based on student progress',
        'Support diverse learning styles and accessibility requirements',
      ],
    },
    {
      icon: AlertTriangle,
      title: 'Deter Misuse',
      description: 'Implement safeguards to maintain academic integrity and responsible use',
      points: [
        'Monitor usage patterns to identify potential misuse',
        'Implement detection systems for unauthorized assistance',
        'Educate users on responsible AI interaction practices',
        'Provide clear consequences for policy violations',
      ],
    },
  ];

  return (
    <main>
      <Navbar />

      <section className="py-20 md:py-28 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionTitle
            title="Our Approach"
            subtitle="Cogitatis AI is built on three core principles that guide every feature and interaction"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {approaches.map((approach) => (
              <ApproachCard key={approach.title} {...approach} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionTitle
            title="Our Implementation Strategies"
            subtitle="Three strategic pillars that ensure responsible and effective AI integration in education"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {strategies.map((strategy) => (
              <StrategyCard key={strategy.title} {...strategy} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
